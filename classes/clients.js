'use strict'

const logger = require('justewg-common/utils/logger')()
const req = require('justewg-common/utils/req')

const sessionClass = require('../classes/session')


require('dotenv').config()


/**
 * Класс клиента API
 */
class ewgVKBotClients {
    /**
     * Конструктор класса
     */
    constructor(args = {}) {
        this.id = null
        this.owner = null
        this.code = null
        this.type = null
        this.name = null
        this.enabled = false
        this.options = {}
        
        this.fields = ['owner', 'code', 'type', 'category', 'name', 'enabled', 'options']
        
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
     * Возврващает из БД данные клиента по ее ID
     *
     * @param ctx - Контекст приложения
     * @param id - ID клиента
     * @returns {Promise.<*>}
     */
    async get(ctx, id) {
        return await this.__request(ctx, 'GET', `/api/clients/${id}`)
    }
    
    /**
     * Возврващает из БД данные всех клиентов
     *
     * @param ctx - Контекст приложения
     * @returns {Promise.<*>}
     */
    async all(ctx) {
        return await this.__request(ctx, 'GET', `/api/clients/`)
    }

    /**
     *
     * @param ctx
     * @param args
     * @returns {Promise.<void>}
     */
    async search(ctx, args) {
        const all = await this.all(ctx)
        logger.log('***', args, all.data.length)
        if (all.data) {
            all.data = all.data.filter(item => {
                let res = true, keys = Object.keys(args)
                for (let i = 0; i < keys.length; i++) {
                    if (item[keys[i]] && (typeof args[keys[i]]).toLowerCase() === 'object') {
                        let subkeys = Object.keys(args[keys[i]])
                        for (let j = 0; j < subkeys.length; j++) {
                            res = res && item[keys[i]][subkeys[j]] === args[keys[i]][subkeys[j]]
                        }
                    } else {
                        res = res && item[keys[i]] === args[keys[i]]
                    }
                }
                return res
            })
        }
        logger.log(all.data)
        return all
    }
}

module.exports = ewgVKBotClients
