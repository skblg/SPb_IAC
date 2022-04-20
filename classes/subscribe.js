'use strict'

const logger = require('justewg-common/utils/logger')()
const req = require('justewg-common/utils/req')

const sessionClass = require('../classes/session')


require('dotenv').config()


/**
 * Класс подписки какой-либо беседы в группе ВК на оповещения по настройкам чатбот-проекта
 */
class ewgVKBotSubscribe {
    /**
     * Конструктор класса
     */
    constructor(args = {}) {
        this.id = null
        this.user = null
        this.bot = null
        this.group = null
        this.app = null
        this.chat = null
        this.mode = null
        
        this.fields_map = {id: 'id', user: 'user_id', bot: 'bot_id', group: 'group_id', app: 'app_id', chat: 'chat_id', mode: 'mode'}

        const keys = Object.keys(args)
        for (let i = 0; i < keys.length; i++) {
            this[keys[i]] = args[keys[i]]
        }
    
        this.log_prefix = this.log_prefix || `Класс ${this.constructor.name}: `
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
    
        logger.log(`${this.log_prefix}Отправляем ${method}-запрос ко внешнему API: ${url}`)
    
        ctx.session = await (new sessionClass()).getSession()
        
        await req.make(ctx, url, Object.assign({
            API_URL: process.env.IAC_API,
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
     * Возврващает все подписки в соответствие с запросом, взятые из внешнего API
     *
     * @param ctx - Контекст приложения
     * @param args - Аргументы запроса
     * @returns {Promise.<*>}
     */
    async search(ctx, args = {}) {
        // Определяем данные для записи из текущего экземпляра класса с маппингом полей
        const data = {}
        const keys = Object.keys(this.fields_map)
        for (let i = 0; i < keys.length; i++) {
            if (args.hasOwnProperty(keys[i])) {
                data[this.fields_map[keys[i]]] = args[keys[i]]
            }
        }
        const result = await this.__request(ctx, 'GET', '/api/subscribes/search/', data)
        result.data = result.data.filter(item => {
            let res = true
            for (let i = 0; i < keys.length; i++) {
                if (args.hasOwnProperty(keys[i])) {
                    res = res && args[keys[i]] === item[keys[i]]
                }
            }
            return res
        })
        return result
    }
    
    /**
     * Добавляет данные подписки по ее ID в БД
     *
     * @param ctx - Контекст приложения
     * @returns {Promise.<*>}
     */
    async add(ctx) {
        // Определяем данные для записи из текущего экземпляра класса с маппингом полей
        const data = {}
        const keys = Object.keys(this.fields_map)
        for (let i = 0; i < keys.length; i++) {
            if (this[keys[i]]) {
                data[this.fields_map[keys[i]]] = this[keys[i]]
            }
        }
        
        return await this.__request(ctx, 'POST', '/api/subscribes/', data)
    }
    
    /**
     * Удаляет данные подписки по ее ID из БД
     *
     * @param ctx - Контекст приложения
     * @returns {Promise.<*>}
     */
    async delete(ctx) {
        return await this.__request(ctx, 'DELETE', `/api/subscribes/${this.id}`)
    }
}

module.exports = ewgVKBotSubscribe
