'use strict';

const logger = require('justewg-common/utils/logger')();
const workerpool = require('workerpool')

const sessionClass = require('../classes/session')
const clientsClass = require('../classes/clients')

// Директория с директориями-задачами
const TASKS_DIR = 'tasks'

// Базовый запускаемый файл с каждой директории-задаче
const DEFAULT_TASK_FILENAME = 'runner.js'

// Текущий контекст приложения
let ctx = {}

let pool = null
let session = null

const log_prefix = 'APP: '

/**
 * Класс пула запускаемых воркеров
 *
 * @constructor
 */
function Runner () {
    let self = this
    
    /**
     * Добавляет воркер в список обрабатываемых
     *
     * @param taskFolder - Путь к каталогу с задачей
     * @param args - Глобальные аргументы задачи
     * @returns {Pool}
     */
    self.addWorker = async (taskFolder, args = {}) => {
        pool = workerpool.pool(`${taskFolder}/${DEFAULT_TASK_FILENAME}`)
        if (pool) {
            try {
                await pool
                    .exec('runner',
                        [args],
                        {
                            workerType: 'auto',
                            on: (payload) => {
                                logger.log(payload.status)
                            }
                        }
                    )
                    .catch(function (err) {
                        logger.log('catch')
                        logger.error(err)
                        pool.terminate() // terminate all workers when done
                    })
            } catch (e) {
                logger.error(e)
            }
        }
        return pool
    }
    
    /**
     * Стартует сессию, получает API-токен, записывает в сессию
     *
     * @returns {Promise.<void>}
     */
    const startSession = async () => {
        try {
            session = new sessionClass()
            await session.getToken(ctx)
            await session.startChecking(ctx)
        } catch (err) {
            logger.error(err)
        }
        ctx = { session: session }
    }
    
    /**
     * Читает текущий список клиентов и создает из них обрабатываемый пул, запуская в параллель задачи по их типам
     *
     * @returns {Promise.<void>}
     */
    self.run = async () => {
        let folder

        await startSession()
        ctx.session = await session.getSession()

        if (!ctx.session.token || typeof ctx.session.token === 'undefined') {
            logger.error(`${log_prefix}Ошибка авторизации в API. Приложение остановлено`)
        } else {
            const clients = await (new clientsClass()).all(ctx)

            if (clients.success === true && clients.data.length > 0) {
                try {
                    for (let i = 0; i < clients.data.length; i++) {

                        // Если клиент активирован и в его настройках - тот же публичный хост, что и в .env
                        if (clients.data[i].enabled === true && clients.data[i].host === process.env.APP_PUBLIC_HOST) {

                            switch (clients.data[i].type) {
                                case 'vk_chat_bot':
                                case 'tg_chat_bot':
                                    folder = 'vk_tg_chat_bot'
                                    break;
                                default:
                                    folder = clients.data[i].type
                                    break;
                            }
    
                            // TODO добавить обработчик несуществующей папки с типом проекта
                            await self.addWorker(
                                `${__dirname}/${TASKS_DIR}/${folder}`,
                                {
                                    ctx: ctx,
                                    idx: i + 1,
                                    client_id: clients.data[i].id
                                }
                            )
                        }
                    }
                    await self.addWorker(`${__dirname}/${TASKS_DIR}/vk_callbacks_proxy`, {ctx: ctx})
                } catch (e) {
                    logger.error(e)
                }
            } else {
                logger.error('Нет найдены API-клиенты в БД, ошибка:', clients.reason)
            }
        }
    }
    
    return self
}

logger.log('🔸️  Workers Runner initiated')

module.exports = Runner;
