'use strict'

const logger = require('justewg-common/utils/logger')()
const req = require('justewg-common/utils/req')


const sessionClass = require('../classes/session')


require('dotenv').config()


/**
 * Класс ВК-пользователя чатбота
 */
class ewgVKBotUser {
    /**
     * Конструктор класса
     */
    constructor(args = {}) {
        this.id = null
        this.email = null
        this.username = null
        this.auth = null

        this.required = ['id', 'username', 'auth', 'options']
        
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
     * Возврващает из БД данные подписки по его ID
     *
     * @param ctx - Контекст приложения
     * @param id - ID подписки
     * @returns {Promise.<*>}
     */
    async get(ctx, id) {
        const result = await this.__request(ctx, 'GET', `/api/users/${id}`)
        
        if (result.success === true) {
            for (let i = 0; i < this.required.length; i++) {
                this[this.required[i]] = result.data[this.required[i]]
            }
        }
        
        return result
    }
    
    /**
     * Возвращает из БД данные пользователя по его Telegram-идентификатору
     *
     * @param ctx - Контекст приложения
     * @param authType - Тип провайдера авторизации
     * @param uid - Telegram-идентификатор пользователя
     * @returns {Promise.<*>}
     */
    async getByAuthProviderId(ctx, authType, uid) {
        const result = await this.__request(ctx, 'GET', `/api/users/auth_provider/${authType}/${uid}`)
        if (result.success === true) {
            for (let i = 0; i < this.required.length; i++) {
                this[this.required[i]] = result.data[this.required[i]]
            }
        }
        
        return result
    }
    /**
     * Добавляет данные пользователя по его ID в БД
     *
     * @param ctx - Контекст приложения
     * @returns {Promise.<*>}
     */
    async add(ctx) {
        // Определяем данные для записи из текущего экземпляра класса
        const data = { provider: this.provider || 'vk' }
        for (let i = 0; i < this.required.length; i++) {
            data[this.required[i]] = this[this.required[i]]
        }
        
        return await this.__request(ctx, 'POST', '/api/auth/register/', data)
    }
    
    /**
     * Возвращает всех пользователей в соответствие с полнотекстовым запросом, взятые из внешнего API
     *
     * @param ctx - Контекст приложения
     * @param args - Аргументы запроса
     * @returns {Promise.<*>}
     */
    async search(ctx, args = {}) {
        return await this.__request(ctx, 'GET', '/api/users/search/', args)
    }
    
    /**
     * Сохраняет данные объекта пользователя по его ID в БД
     *
     * @param ctx - Контекст приложения
     * @returns {Promise.<*>}
     */
    async update(ctx) {
        // Определяем данные для записи из текущего экземпляра класса
        const data = {}
        for (let i = 0; i < this.required.length; i++) {
            data[this.required[i]] = this[this.required[i]]
        }
        
        return await this.__request(ctx, 'PUT', `/api/users/${this.id}`, data)
    }
}

module.exports = ewgVKBotUser
