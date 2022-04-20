'use strict';

const logger = require('justewg-common/utils/logger')();
const req = require('justewg-common/utils/req')
const common = require('justewg-common/utils')
const fetch = require('node-fetch');
const fs = require('fs');
const moment = require('moment')
const easyvk = require('easyvk')

const errors = require('../errors')
const sessionClass = require('../classes/session')
const templates = require('../config/msg_templates')


let ctx = {}


require('dotenv').config()


/**
 * Класс объекта импорта данных обращений
 */
class Importer {
    constructor(args = {}) {
        this.id = null
        this.interval = null
        this.cache_prefix = 'vkbot_import_'
        this.bot = null
        this.getter_url = ''
        this.log_prefix = ''
        const keys = Object.keys(args)
        for (let i = 0; i < keys.length; i++) {
            this[keys[i]] = args[keys[i]]
        }
        this.storage = this.bot.cacher
    }
    
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
    async __request (ctx, method, url, args = {}) {
        let result = { success: false }
        
        logger.log(`${this.log_prefix}Отправляем ${method}-запрос ко внешнему API: ${args.API_URL || process.env.IAC_API}${url}`)
        ctx.session = await (new sessionClass()).getSession()
        
        await req.make(ctx, url, Object.assign({
            API_URL: args.API_URL || process.env.IAC_API,
            method: method
        }, args)).then( response => {
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
     * Запускает текущий процесс периодических batch-импортов
     *
     * @param args - Аргументы старта
     */
    async start(args = {}) {
        const self = this
        logger.log(`${this.log_prefix}Импорт установлен`)
    
        new Promise(resolve => {
            self.intervalHandler = setInterval(() => {
                resolve(self.run.call(self, [args]))
            }, this.interval * 60 * 1000)
        })

        return await this.run(args)
    }
    
    /**
     * Останавливает текущий процесс периодических batch-импортов
     */
    stop() {
        if (this.intervalHandler) {
            clearInterval(this.intervalHandler)
            this.intervalHandler = null
        }
    }
    
    /**
     * Возвращает статус импорта по задаче из объекта
     *
     * @returns {{tm: number, state: *}|*}
     */
    getCurrentState () {
        return this.state
    }
    
    /**
     * Устанавливает в объекте текущий статус импорта по задаче и записывает его в storage
     *
     * @param state
     * @returns {Promise.<*>}
     */
    async setCurrentState (state) {
        this.state = {
            tm: moment.now(),
            state: state
        }
        return await this.storage.set(`${this.cache_prefix}${this.bot.code}_last_run`, JSON.stringify(this.state))
    }
    
    /**
     * Возвращает статус импорта по задаче, сохраненный в storage
     *
     * @returns {Promise.<*>}
     */
    async getPreviousState () {
        const cached = await this.storage.get(`${this.cache_prefix}${this.bot.code}_last_run`)
        let state = null
        try {
            state = JSON.parse(cached)
        } catch (e) {
            logger.error(`${this.log_prefix}`, e)
        }
        return state
    }
    
    getURL(){
        return this.getter_url || ''
    }
    
    /**
     * Возвращает из storage ID последней импортированной записи по текущей задаче
     *
     * @returns {Promise.<*>}
     */
    async getLastIndex () {
        let lastIndex = null
        await this.storage
            .get(`${this.cache_prefix}${this.bot.code}_last_sended_problem_id`)
            .then( (result) => {
                try {
                    if (result !== '' ) {
                        lastIndex = parseInt(result, 10)
                    }
                } catch (e) {
                    logger.error(`${this.log_prefix}`, e)
                }
            })
        if (!lastIndex || lastIndex === 0 || typeof lastIndex === 'undefined') {
            logger.error(`${this.log_prefix}!!!!!!! FATAL ERROR: НЕТ ID ПОСЛЕДНЕГО ИМПОРТИРОВАННОГО СООБЩЕНИЯ В БД`)
            lastIndex = 1 // 10000000 //3768973 //3713871
        }
        return lastIndex
    }
    
    /**
     * Возврващает данные последних обращений, взятые из внешнего API
     *
     * @param ctx - Контекст приложения
     * @param self - Объект ImportTask, из которого вызвана эта подзадача
     * @param args - Аргументы запроса
     * @returns {Promise.<*>}
     */
    async getter(ctx, self, args = {}) {
        let result = { success: false }
        
        // Формируем URL запроса к внешнему API
        let url = this.getURL()
        if (!url || url === ''){
            result.error = `Ошибка получения URL данных новых обращений`
            return result
        }
        // Определяемся с последним импортированным по этой субзадаче обращением
        let lastIndex = args.after || await self.getLastIndex()
        if (!lastIndex || typeof lastIndex === 'undefined') {
            lastIndex = 1000000000
        }
        url += (url.match(/\?/) ? '&' : '?') + 'after=' + lastIndex

        const API_URL = process.env.IAC_API
        
        logger.log(`${this.log_prefix}Отправляем запрос ко внешнему API: ${API_URL}${url}`)
    
        return await this.__request(ctx, 'GET', url, { API_URL })
    }
    
    /**
     * Создает сообщение для отправки в ВК по данным обращения
     *
     * @param p - Массив данных обращения
     * @param subscribe - Объект подписки
     * @returns {Promise.<{body: string, attachments: Array}>}
     */
    async createMessage(p, subscribe) {
        let attachments = []
        const self = this
        let vk = null;
        let imgURL;
        if (p.petition && p.petition.photos && p.petition.photos.length > 0) {
            for (let ph = 0; ph < p.petition.photos.length ; ph++) {
                if (ph === 0) {
                    // Составляем URL первого из изображений, прикрепленных к обращению
                    imgURL = `${'https://gorod.gov.spb.ru/storage/1/' + p.petition.photos[ph].file_uuid + '.' + p.petition.photos[ph].file.replace(/^.+\./g, '')}`

                    // Для Telegram-чатбота
                    if (self.bot.type === 'tg_chat_bot') {
                        const localFile = '/tmp/vkbot-uploaded-' + Math.round(Math.random() * 1000000)
                        await fetch(imgURL)
                            .then(res => {
                                res.body.pipe(fs.createWriteStream(localFile));
                                attachments.push(localFile)
                            })
                            .catch( err => {
                                logger.error(err)
                            });
                    }

                    // Для ВК-чатбота
                    else if (self.bot.type === 'vk_chat_bot') {
                        await easyvk({
                            token: this.bot.token,
                        }).then(async vk => {
                            return vk.uploader.getUploadURL('photos.getMessagesUploadServer', {
                                group_id: subscribe.group
                            }, true)
                        }).then(async ({url, vkr}) => {
                            url = url.upload_url

                            let fileData = await vk.uploader.uploadFetchedFile(url, imgURL, 'photo', {})

                            fileData = await vk.post('photos.saveMessagesPhoto', fileData)
                            fileData = fileData[0]

                            attachments.push(
                                `photo${fileData.owner_id}_${fileData.id}_${fileData.access_key}`
                            )
                        }).catch(err => {
                            logger.error(`${this.log_prefix}`, err)
                        })
                    }
                }
            }
        }
    
        // Составляем текст сообщения по заданному шаблону
        return {
            body: templates.single_problem.compose(ctx, {p, subscribe, bot_type: this.bot.type}),
            attachments: attachments
        }
    }
    
    /**
     * Отправляет записи о новых обращениях в ВК-беседу
     *
     * @param ctx - Контекст приложения
     * @param problems - Список обращений
     * @returns {Promise.<{success: boolean}>}
     */
    async sendProblemsToVK (ctx, problems = []) {
        let result = { success: false }
        function sleep (time) {
            return new Promise((resolve) => setTimeout(resolve, time));
        }

        if (problems && problems.length > 0) {
            // Определяем максимальный id полученных новых сообщений
            problems = problems.sort((a, b) => a.id - b.id)
            
            result.data = {sended: {count: 0, ids: []}}
        
            logger.log(`${this.log_prefix}Обращения для импорта: ${problems.map(p => p.id).join(', ')}`)
            
            // Определяем текущие подписки на оповещения о каждом обращении отдельно
            let subscribes = []
            const subscribesClass = require('./subscribe')
            let opts = {
                bot: this.bot.id,
                mode: 'every'
            }
            if (this.bot.type === 'vk_chat_bot') {
                opts.group = this.bot.group_id
            } else if (this.bot.type === 'tg_chat_bot') {
            }
            const currentSubscribesResponse = await (new subscribesClass({log_prefix: this.log_prefix})).search(ctx, opts)
            if (currentSubscribesResponse.success === true && currentSubscribesResponse.data.length > 0) {
                subscribes = []
                for (let s = 0; s < currentSubscribesResponse.data.length; s++) {
                    subscribes.push(new subscribesClass(Object.assign({
                        log_prefix: this.log_prefix,
                        app: this.bot.app_id,
                    }, opts, currentSubscribesResponse.data[s])))
                }
            }
            // logger.log(subscribes)
            let resultOneSub, resultOneProblem
        
            const maxId = problems[problems.length - 1].id
            // Для всех обращений
            for (let i = 0; i < problems.length; i++) {
                // ...и для всех подписок на отдельные обращения
                resultOneProblem = { result: true }
                for (let s = 0; s < subscribes.length; s++) {
                    logger.log(`${this.log_prefix}Импорт Отправляем сообщение #${problems[i].id} в чат #${subscribes[s].chat}`)
                    const message = await this.createMessage(problems[i], subscribes[s])
                
                    try {
                        resultOneSub = await sleep(1000).then(async () => {
                            await this.bot.sendMessage(subscribes[s].chat, message.body, message.attachments)
                        });
                        resultOneProblem.success = resultOneProblem.success && resultOneSub.success
                    } catch (err) {
                        logger.error(`${this.log_prefix}`, Object.assign(errors.getByCode(1102), {e: err}))
                    }
                }
                if (resultOneProblem.success === true) {
                    result.data.sended.count++
                    result.data.sended.ids.push(problems[i].id)
                }
            }
            try {
                // Записываем максимальный ID в Редис
                await this.storage.set(`${this.cache_prefix}${this.bot.code}_last_sended_problem_id`, maxId)
                logger.log(`${this.log_prefix}Обновлен ID последнего импортированного сообщения: ${maxId}`)
            } catch (err) {
                logger.error(`${this.log_prefix}`, Object.assign(errors.getByCode(1201), {e: err}))
            }
            result.success = true
        }
    
        if (result.success === true) {
            // logger.log(`${this.log_prefix}Импорт Отправлены обращения(${result.data.sended.count}): ${result.data.sended.ids.join(', ')}`)
        }
    
        return result
    }
    
    /**
     * Добавляет записи в локальную БД
     *
     * @param ctx - Контекст приложения
     * @param data - Массив добавляемых записей
     * @returns {Promise.<{success: boolean}>}
     */
    async saveProblemsToLocalDB (ctx, data) {
        return await this.__request(ctx, 'POST', '/api/problems/import', {
            data: data
        })
    }
    
    /**
     * Запускает однократный процесс импорта данных в соответствие с задачей
     *
     * @param args - Аргументы запуска
     * @returns {Promise.<{success: boolean}>}
     */
    async run(args = {}) {
        // Наследуем контекст прилоения от workers/index
        if (args.ctx) {
            ctx = Object.assign({}, ctx, args.ctx)
        }

        let result = { success: false }
    
        let previousProcess = null//await this.getPreviousState()
        if (!previousProcess) {
            this.setCurrentState('idle')
            previousProcess = this.bot.getCurrentState()
        }
        
        if (previousProcess.state !== 'started') {
            logger.log(`${this.log_prefix}Импорт cтартовал`)
            
            this.setCurrentState('started')
    
            // Определяем текущие подписки на оповещения о каждом обращении отдельно
            let subscribes = []
            const subscribesClass = require('./subscribe')
            let opts = {
                bot: this.bot.id,
                mode: 'every'
            }
            if (this.bot.type === 'vk_chat_bot') {
                opts.group = this.bot.group_id
            } else if (this.bot.type === 'tg_chat_bot') {
            }
            const currentSubscribesResponse = await (new subscribesClass({log_prefix: this.log_prefix})).search(ctx, opts)
            if (currentSubscribesResponse.success === true && currentSubscribesResponse.data.length > 0) {
                subscribes = [new subscribesClass(Object.assign({log_prefix: this.log_prefix}, currentSubscribesResponse.data[0]))]
            }

            if (subscribes.length > 0) {
                // Получаем новые записи из внешней БД
                const imported = await this.getter.call(this, ...[ctx, this])
    
                if (imported.success === true) {
                    if (imported.data.length > 0) {
                        logger.log(`${this.log_prefix}Доступно ${imported.data.length} записей для импорта, ID: ${common.limitArrayWithEllipsis(imported.data, 10).map(r => r.id)}`)
            
                        // Отправляем записи в VK-беседу
                        const recorded = await this.sendProblemsToVK(ctx, imported.data)
                        if (recorded.success === true) {
                            logger.log(`${this.log_prefix}Импортировано ${imported.data.length} записей, ID: ${common.limitArrayWithEllipsis(imported.data, 10).map(r => r.id)}`)
                            result.success = true
                        } else {
                            result.error = recorded.error
                            logger.error(`${this.log_prefix}Ошибка импорта, response: ${JSON.stringify(result)}`)
                        }
                    } else {
                        logger.log(`${this.log_prefix}Нет новых записей для импорта`)
                        result.success = true
                    }
                } else {
                    result.error = imported.error
                    logger.error(`${this.log_prefix}Ошибка импорта, response: ${JSON.stringify(result)}`)
                }
            } else {
                logger.log(`${this.log_prefix}Отсутствуют подписки на новые сообщения, импорт отменен`)
            }

            this.setCurrentState('finished')
        } else {
            logger.log(`${this.log_prefix}Не завершен предыдущий процесс импорта от ${moment(previousProcess.tm).format(process.env.DATETIME_FORMAT)}`)
        }
        
        return result
    }
}

module.exports = Importer;