'use strict';

const logger = require('justewg-common/utils/logger')();
const req = require('justewg-common/utils/req')
const express = require('express')
const bodyParser = require('body-parser')
const Redis = require('ioredis')
const workerpool = require('workerpool')

const clientsClass = require('../../../classes/clients')
const sessionClass = require('../../../classes/session')

const log_prefix = 'VK-callbacks-proxy: '
let ctx = { session: {} }


require('dotenv').config()


/**
 * Общий метод запроса к внешнему API и стандартной интерпретации результатов
 *
 * @param ctx - Контекст приложения
 * @param method - HTTP-метод запроса
 * @param url - URL запроса
 * @param args - Аргументы запроса
 * @returns {Promise.<{success: boolean}>}
 * @private
 */
const __request = async (ctx, method, url, args = {}) => {
    let result = { success: false }
    
    ctx.session = await (new sessionClass()).getSession()

    args = Object.assign({ method: method }, args)
    
    await req.make(ctx, url, args).then( response => {
        if (response.status === 200) {
            result = Object.assign(
                result,
                { success: true },
                response
            )
            if (!result.hasOwnProperty('data') || result.data.length === 0) {
                result.data = []
            }
        } else {
            result = Object.assign(
                result,
                { success: true },
                response
            )
        }
    }).catch( reason => {
        // TODO переделать в АПИ чтобы возвращался success true и пустой массив
        result = Object.assign(
            result,
            reason,
            { reason: reason }
        )
    })
    
    return result
}

/**
 * Стартует HTTP-сервер на указанном порту
 *
 * @param ctx - Контекст приложения
 * @param port - Порт сервера
 * @param clients - Список всех клиентов для обработки коллбэков
 * @returns {*}
 */
const setServer = (ctx, port, clients) => {
    // Стартуем веб-сервер для вебхуков и некоторых кастомных страниц
    const server = express()
    
    server.use(bodyParser.json())
    server.use(bodyParser.urlencoded({ extended: true }))
    
    // Пустая страница для отладки аякс-POST-запросов с того же домена
    server.get('/test', (req, res) => {
        res.send("<html><head><script src=\"https://cdnjs.cloudflare.com/ajax/libs/jquery/3.6.0/jquery.min.js\" integrity=\"sha512-894YE6QWD5I59HgZOGReFYm4dnWc1Qt5NtvYSaNcOP+u1T9qYdvdihz0PPSiiqn/+/3e7Jo4EaG7TubfWGUrMQ==\" crossorigin=\"anonymous\" referrerpolicy=\"no-referrer\"></script></head><body></body></html>")
    })
    
    // Обработчик для коллбэков от API чатбота
    server.post('/callback', async (req, res) => {
        const data = req.body

        logger.log(`${log_prefix}${JSON.stringify(data)}`)

        let result = 'ok'
        for (let i = 0; i < clients.length; i++) {

            // Для клиента, указанного в полученном сообщении
            if ((req.headers.host === clients[i].host || req.headers.host === 'tech.petersburg.ru')
                && (
                    (clients[i].type === 'vk_chat_bot' && ('' + data.group_id) === ('' + clients[i].options.group_id))
                    || (clients[i].type === 'tg_chat_bot')
                )
            ) {
                // Если он в настройках включен - идем обрабатывать в его собственный чатбот-б\кенд
                if (clients[i].enabled === true) {
                    
                    // Если это запрос на проверку коллбэк-сервиса он ВК - отдаем confirmation-код из настроек
                    if (data.type === 'confirmation') {
                        // https://vk.com/club206187753?act=api
                        result = clients[i].options.vk_confirmation_code
                    } else {
                        logger.log(`${log_prefix}Отправляем запрос на клиент ${clients[i].code}`)
                        try {
                            // Перенаправляем входящий запрос на сервер-порт клиента, определенного в его настройках
                            result = await __request(ctx, 'POST', `/callback`, Object.assign({headers: {host: req.headers.host}, API_URL: `http://127.0.0.1:${port + i + 1}`}, data))
                            if (result.success !== true) {
                                logger.error(`${log_prefix}Ошибка при обработке на клиенте ${clients[i].code}`, result)
                                result = 'error'
                            } else {
                                result = 'ok'
                            }
                        } catch (e) {
                            logger.error(e)
                            result = 'error'
                        }
                    }
                } else {
                    // TODO оптимизировать, убрать в вызываемые методы других контроллеров (есть в конструкторе класса бота)
                    // Устанавливаем редис-кэшер
                    this.cacher = new Redis({
                        port: process.env.REDIS_PORT,
                        host: process.env.REDIS_HOST,
                        db: process.env.REDIS_DATABASE,
                        password: process.env.REDIS_PASSWORD,
                    })
                    let response = await this.cacher.get('vkbot_message_events') || "[]"
                    let messageEvents = []
                    try {
                        messageEvents = JSON.parse(response)
                        if (messageEvents.indexOf(data.event_id) === -1) {
                            messageEvents.push(data.event_id)
                            await this.cacher.set('vkbot_message_events', JSON.stringify(messageEvents))
                            result = 'error'
                        } else {
                            logger.error(`${log_prefix}Сообщение #${message.event_id} уже обработано`)
                        }
                    } catch (e) {
                        logger.error(`${log_prefix}Ошибка парсинга ответа от кэш-контроллера, ${e}`)
                    }
                }
            }
        }
        res.send(result)
    })
    
    server.listen(port)
    
    logger.log(`${log_prefix}Сервер стартовал на порту ${port}`)
    
    return server
}

/**
 * Главный метод задачи
 *
 * @returns {Promise.<{success: boolean}>}
 */
const run = async (args = {}) => {
    // Наследуем контекст прилоения от workers/index
    if (args.ctx) {
        ctx = Object.assign({}, ctx, args.ctx)
    }
    ctx.session = await (new sessionClass()).getSession()
    
    // Получаем список всех клиентов
    const clients = await (new clientsClass()).all(ctx)
    
    // Если он есть и непустой
    if (clients.success === true && clients.data) {

        // TODO проверить на корректность задания номера порта
        // Идем создавать сервер обработки коллбэков
        setServer(ctx, args.port || parseInt(process.env.PORT, 10), clients.data)
    } else {
        logger.error(`${log_prefix}Нет списка обрабатываемых API-клиентов`)
        return false
    }
    
    return true
}

// Регистрируем воркера и задаем ему публичные методы
workerpool.worker({
    runner: (async (args) => {
        await run(args)
    })
})
