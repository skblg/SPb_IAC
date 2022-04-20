'use strict'

// const {VKApi, ConsoleLogger, BotsLongPollUpdatesProvider} = require('node-vk-sdk')
const VkBot = require('node-vk-bot-api');
const moment = require('moment')
const Redis = require('ioredis')
const logger = require('justewg-common/utils/logger')()

const req = require('justewg-common/utils/req')
const sessionClass = require('../classes/session')
const clientsClass = require('../classes/clients')

const errors = require('../errors')


const { Telegraf } = require('telegraf')
const fs = require('fs')


require('dotenv').config()


let ctx = {}
let messageEvents = []


/**
 * Класс объекта чатбота для общения в группе ВК
 */
class ewgVKBot {
    /**
     * Конструктор класса
     */
    constructor(args = {}) {
        this.commands = require('../config/bot_commands')
        this.id = null
        this.token = null
        this.type = null
        this.group_id = null
        this.app_id = null
        this.chat_id = null
        this.user = null
        this.users = {}
        this.interval = 1
        this.LogTelegramChatId = process.env.LOG_TG_GROUP_ID
        this.cacher = null
        this.cache_prefix = 'vkbot_'
        this.server = null
        this.transport = null
        this.state = {
            tm: moment.now(),
            state: 'idle'
        }

        const keys = Object.keys(args)
        for (let i = 0; i < keys.length; i++) {
            this[keys[i]] = args[keys[i]]
        }
    
        this.log_prefix = `Бот ${this.code}: `

        if (this.token && this.token !== '') {
            // Устанавливаем объект чатбот-транспорта
            if (this.type === 'vk_chat_bot') {
                this.transport = new VkBot({ token: this.token })
            } else if (this.type === 'tg_chat_bot') {
                this.transport = new Telegraf(this.token)
            } else {
                logger.error(`${this.log_prefix}Неподдерживаемый тип бота: ${this.type}`)
            }

            // Устанавливаемредис-кэшер
            this.cacher = new Redis({
                port: process.env.REDIS_PORT,
                host: process.env.REDIS_HOST,
                db: process.env.REDIS_DATABASE,
                password: process.env.REDIS_PASSWORD,
            })
        } else {
            logger.error(Object.assign(errors.getByCode(1103)))
        }

        if (this.transport !== null) {
            logger.log(`${this.log_prefix}Создан`)
        }
    }

    async getClient (ctx) {
        let args = {
            enabled: true,
            type: this.type,
            options: {
                token: this.token
            }
        }
        const cl = new clientsClass({log_prefix: this.log_prefix})
        return await cl.search(ctx, args)
    }

    /**
     * Устанавливает webhook-коллбэк в случае Telegram-чатбота
     *
     * @returns {Promise.<void>}
     */
    async setCallBacks () {
        await this.transport.telegram.setWebhook(process.env.IAC_API + '/tgbot/callback', {
            source: process.env.PATH_TO_API_CERTIFICATE
        })

        this.transport.startWebhook('/tgbot/callback')
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
        return await this.storage.set(`${this.cache_prefix}${this.id}_state`, JSON.stringify(this.state))
    }
    
    /**
     * Возвращает статус импорта по задаче, сохраненный в storage
     *
     * @returns {Promise.<*>}
     */
    async getPreviousState () {
        const cached = await this.storage.get(`${this.cache_prefix}${this.id}_state`)
        let state = null
        try {
            state = JSON.parse(cached)
        } catch (e) {
            logger.error(e)
        }
        return state
    }

    /**
     * Возвращает флаг того, что указанное сообщение -- не текстовое, а сервисное
     *
     * @param data - Объект сообщения
     * @returns {*}
     */
    isServiceMessage (data) {
        return (data && data.message && (data.message.new_chat_member || data.message.left_chat_member))
    }
    
    /**
     * Стартует HTTP-сервер на указанном порту
     *
     * @param ctx - Контекст приложения
     * @param port - Порт сервера
     * @returns {*}
     */
    setServer(ctx, port) {
        const self = this
        
        const express = require('express');
        const bodyParser = require('body-parser');

        // Стартуем веб-сервер для вебхуков и некоторых кастомных страниц
        this.server = express()
    
        this.server.use(bodyParser.json())
        this.server.use(bodyParser.urlencoded({ extended: true }))
    
        this.server.get('/test', (req, res) => {
            res.send("<html><head><script src=\"https://cdnjs.cloudflare.com/ajax/libs/jquery/3.6.0/jquery.min.js\" integrity=\"sha512-894YE6QWD5I59HgZOGReFYm4dnWc1Qt5NtvYSaNcOP+u1T9qYdvdihz0PPSiiqn/+/3e7Jo4EaG7TubfWGUrMQ==\" crossorigin=\"anonymous\" referrerpolicy=\"no-referrer\"></script></head><body></body></html>")
        })

        // Обработчик для ВК-коллбэков
        this.server.post('/callback', async (req, res, next) => {
            const data = req.body

            let txt = null
            let result = { success: true }

            if (self.isServiceMessage(data)) {
                if (data && data.message && data.message.new_chat_member) {
                    txt = `Чатбот добавлен в новую группу ${data.message.chat.title} (🆔: <code>${data.message.chat.id}</code> )`
                    data.message.text = '/subscribe:every'
                    result = await self.manageMessage(ctx, data)
                }
                if (txt) {
                    try {
                        await self.transport.telegram.sendMessage(self.LogTelegramChatId, txt, {parse_mode: 'HTML'})
                    } catch (e) {
                        logger.error(e)
                    }
                }
            } else if (
                (self.type === 'vk_chat_bot' && ('' + data.group_id) === ('' + self.group_id))
                || (self.type === 'tg_chat_bot')
            ) {
                if (data.type === 'confirmation' && ('' + data.group_id) === self.group_id) {
                    res.send(self.options.vk_confirmation_code)
                } else {
                    try {
                        result = await self.manageMessage(ctx, data)
                        if (result.success !== true) {
                            logger.error(result.error)
                        }
                    } catch (e) {
                        result.error = 'Неопознанная ошибка'
                        result.reason = e
                        logger.error(e)
                    }
                    // self.webhookCallback(req, res, next)
                }
            }
            res.send(result)
        })
    
        this.server.listen(port)
    
        logger.log(`${this.log_prefix}Сервер стартовал на порту ${port}`)
    }
    
    /**
     * Проверяет текст входящего сообщения, сопоставляя с одним из объектов поддерживаемых комманд
     *
     * @param msg - Объект сообщения
     * @param cmd - Объект поддерживаемой чатботом комманды
     * @returns {boolean} Флаг того, подходит ли текст сообщения под комманду
     */
    checkCommands(msg, cmd) {
        let exact = false
        if (!msg.hasOwnProperty('text')) {
            return false
        }
        if (cmd.hasOwnProperty('pattern')) {
            try {
                exact = msg.text.match(new RegExp(cmd.pattern.replace(/[/]/g, '\\/')))
            } catch (e) {
                logger.error(e)
            }
            if (exact === null) {
                exact = false
            }
        } else if (cmd.hasOwnProperty('text')) {
            exact = msg.text === cmd.text
        }
        return exact
    }
    
    /**
     * Возвращает из storage ID последней импортированной записи по текущей задаче
     *
     * @returns {Promise.<*>}
     */
    async getLastIndex () {
        let lastIndex = null
        await this.storage
            .get(`${this.cache_prefix}${this.id}_last_sended_problem_id`)
            .then( (result) => {
                try {
                    if (result !== '' ) {
                        lastIndex = parseInt(result, 10)
                    }
                } catch (e) {
                    logger.error(e)
                }
            })
        if (!lastIndex || lastIndex === 0 || typeof lastIndex === 'undefined') {
            logger.error('!!!!!!! FATAL ERROR: НЕТ ID ПОСЛЕДНЕГО ИМПОРТИРОВАННОГО СООБЩЕНИЯ В БД ПО ЗАДАЧЕ ' + this.id)
            lastIndex = 0
        }
        return lastIndex
    }

    /**
     * Возвращает статистику обращений в соответствие с различными фильтрами для публикации в дайджест-сообщениях
     *
     * @param ctx - Контекст приложения
     * @param type - Тип дайджеста
     * @returns {Promise.<{success: boolean}>}
     */
    async getProblemsStat (ctx, type) {
        let from = null
        let url = '/api/stat/'
        if (this.options && this.options.hasOwnProperty('buildings')) {
            url += 'by_buildings/' + this.options.buildings.join(',')
        } else if (this.options && this.options.hasOwnProperty('reasons')) {
            url += 'by_reasons/' + this.options.reasons.join(',')
        } else {
            url += 'global/'
        }
        switch (type) {
            case 'global':
                break;
            case 'weekly':
                from = moment().subtract(7, 'days')
                break;
            case 'daily':
                from = moment().subtract(1, 'day')
                break;
        }
        url += (from ? '?from=' + from.format('YYYY-MM-DDTHH:mm:ss') : '')
        const API_URL = process.env.IAC_API
    
        return await this.__request(ctx, 'GET', url, { API_URL })
    }
    
    /**
     *
     * @param peer_id
     * @param txt
     * @param attachments
     * @returns {Promise.<*>}
     */
    async sendMessage (peer_id, txt, attachments) {
        function sleep (time) {
            return new Promise((resolve) => setTimeout(resolve, time));
        }
        if (this.type === 'vk_chat_bot') {
            return await this.transport.sendMessage(peer_id, txt, {parse_mode: 'MarkdownV2'})
        } else if (this.type === 'tg_chat_bot') {
            if (attachments && attachments.length > 0) {
                logger.log(`${this.log_prefix}Шлем изображение: ${attachments[0]} в ${peer_id}`)
                try {
                    await this.transport.telegram.sendPhoto(peer_id, { source: attachments[0] } )
                    return await sleep(1000).then(async () => {
                        return await this.transport.telegram.sendMessage(peer_id, txt, {parse_mode: 'HTML'})
                    })
                } catch (e) {
                    logger.error(e)
                    return { success: false, error: e}
                }
            } else {
                return await this.transport.telegram.sendMessage(peer_id, txt, {parse_mode: 'HTML'})
            }
        }
    }
    
    /**
     * Обрабатывает callback-сообщения от ВК, отправляет реакции на те, что воспринимаются в соответствии со списком
     * инициализированных поддерживаемых комманд
     *
     * @param ctx - Контекст приложения
     * @param message - Объект callback-сообщения от ВК
     * @returns {Promise.<{success: boolean}>}
     */
    async manageMessage(ctx, message) {
        let result = { success: false }

        let response = await this.cacher.get('vkbot_message_events') || "[]"
        try {
            const messageEventsResponse = JSON.parse(response)
            if (Array.isArray(messageEventsResponse)) {
                messageEvents = messageEventsResponse
            }
        } catch (e) {
            result.error = 'Ошибка парсинга ответа от кэш-контроллера'
            result.reason = e
            return result
        }

        let msg = null
        let authType = null
        if (this.type === 'vk_chat_bot') {
            authType = 'vk'
            msg = message && message.object && message.object.message && message.object.message
        } else if (this.type === 'tg_chat_bot') {
            authType = 'telegram'
            msg = message && message.message
            message.event_id = message.update_id
        }

        if (!msg) {
            result.error = 'Callback без объекта сообщения'
            result.reason = message
            return result
        }

        let chatId = null
        if (this.type === 'vk_chat_bot') {
            chatId = msg.peer_id
        } else if (this.type === 'tg_chat_bot') {
            chatId = msg.chat.id
        }
        if (!chatId) {
            result.error = 'Callback без указания ID чата'
            result.reason = message
            return result
        }
        let msgText = msg.text
        if (!msgText) {
            result.error = 'Callback без текста сообщения'
            result.reason = message
            // return result
        }
        let output

        const user = new (require('./user'))({log_prefix: this.log_prefix})
        let uid = null
        if (this.type === 'vk_chat_bot') {
            uid = parseInt(msg.from_id, 10)
        } else if (this.type === 'tg_chat_bot') {
            uid = parseInt(msg.from.id, 10)
        }
        user.provider = authType
        user.id = uid
        user.username = `Пользователь #${uid}`
        user.options = {}
        let userResponse = await user.getByAuthProviderId(ctx, authType, uid)
        if (userResponse.success !== true) {
            userResponse = await user.add(ctx)
        }
        if (userResponse.success === true) {
            this.user = Object.assign(userResponse.data, {
                group_id: message.group_id,
                chat_id: chatId
            })
            this.users[user.id] = this.user
            
            let ok = false
            for (let i = 0; i < this.commands.length; i++) {
                ok = this.checkCommands(msg, this.commands[i])
                if (ok !== false) {

                    result = { success: false }

                    if (messageEvents.indexOf(message.event_id) === -1) {
                        try {
                            output = await this.commands[i].handler(ctx, this, message, ok)
                            if (output.success === false) {
                                logger.error('Ошибки генерации ответа бота по команде', msg.text || msg.event_id, output.error)
                                await this.sendMessage(msg.peer_id, output.error)
                            }
                            messageEvents.push(message.event_id)
                            await this.cacher.set('vkbot_message_events', JSON.stringify(messageEvents))
                            result.success = true
                            result.data = `${this.log_prefix}Команда обработана`
                        } catch (e) {
                            logger.error(e)
                            result.error = `${this.log_prefix}Неопознанная ошибка`
                            result.reason = e
                        }
                    } else {
                        result.error = `${this.log_prefix}Сообщение #${message.event_id} уже обработано`
                    }
                    break;
                } else {
                    result.error = `${this.log_prefix}Команда не распознана`
                }
            }
        } else {
            // logger.error(`${this.log_prefix}Ошибка получения данных пользователя`, userResponse.error, userResponse.reason)
            result.error = userResponse.error
        }

        return result
    }
    
    // Запускаем периодические задачи экспорта данных из АПИ в ВК
    async setImporter(args = {}) {
        // Наследуем контекст прилоения от workers/index
        if (args.ctx) {
            ctx = Object.assign({}, ctx, args.ctx)
        }

        try {
            const importerClass = require('./import')
            this.importer = new importerClass(Object.assign({}, args, {
                bot: this,
                log_prefix: this.log_prefix
            }))
            await this.importer.start({ctx: ctx})
        } catch (e) {
            logger.error(e)
        }
    }
 }

module.exports = ewgVKBot
