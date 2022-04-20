'use strict'

const logger = require('justewg-common/utils/logger')()
const req = require('justewg-common/utils/req')
const plural = require('plural-ru')
const Redis = require('ioredis')


require('dotenv').config()


/**
 * Класс текущей сессии
 */
class ewgVKBotSession {
    /**
     * Конструктор класса
     */
    constructor(args = {}) {
        this.token = null
        this.user = null
        this.exp = null
        this.iat = null
        this.expired = null
        this.minutes_to_expire = null

        const keys = Object.keys(args)
        for (let i = 0; i < keys.length; i++) {
            this[keys[i]] = args[keys[i]]
        }
    
        this.log_prefix = this.log_prefix || `Класс ${this.constructor.name}: `
        this.cacher = new Redis({
            port: process.env.REDIS_PORT,
            host: process.env.REDIS_HOST,
            db: process.env.REDIS_DATABASE,
            password: process.env.REDIS_PASSWORD,
        })
    }
    
    /**
     * Общий метод запроса к внешнему API и стандартной интерпретации результатов
     *
     * @param method - HTTP-метод запроса
     * @param url - URL запроса
     * @param args - Аргументы запроса
     * @returns {Promise.<{success: boolean}>}
     * @private
     */
    async __request (method, url, args = {}) {
        let result = { success: false }
    
        logger.log(`${this.log_prefix}Отправляем ${method}-запрос ко внешнему API: ${url}`)
        
        const ctx = { session: {token: this.token} }
        
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
            logger.log(76867876876, reason)
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
     * Проводит авторизацию в API
     *
     * @returns {Promise.<*>}
     */
    async getToken () {
        logger.log(`${this.log_prefix}Осуществляем авторизацию`)
        const auth = await this.__request('POST', `/api/auth/login/`, {
            provider: 'local',
            email: process.env.API_USER,
            password: process.env.API_PASSWORD
        })
        if (auth.success === true) {
            const keys = Object.keys(auth.data)
            for (let i = 0; i < keys.length; i++) {
                this[keys[i]] = auth.data[keys[i]]
            }
            await this.saveSession()
        }
    }
    
    /**
     * Проводит авторизацию в API
     *
     * @returns {Promise.<*>}
     */
    async refreshToken () {
        logger.log(`${this.log_prefix}Запрашиваем обновление токена`)
        const auth = await this.__request('POST', `/api/auth/refresh_token/`)
        if (auth.success === true) {
            const keys = Object.keys(auth.data)
            for (let i = 0; i < keys.length; i++) {
                this[keys[i]] = auth.data[keys[i]]
            }
            await this.saveSession()
        }
    }
    
    /**
     * Проводит авторизацию в API
     *
     * @param self - Объект текущего класса
     * @returns {Promise.<*>}
     */
    async checkToken (self) {
        self = self || this
        logger.log(`${self.log_prefix}Проверка активного токена... `)
        const auth = await self.__request('POST', `/api/auth/check/`)
        if (auth.success === true) {
            logger.log(`${self.log_prefix}Токен активен. Минут до окончания действия: ${auth.data.minutes_to_expire}`)
            if (auth.data.minutes_to_expire < (process.env.TOKEN_REFRESH_IF_LESS_THEN || 10)) {
                await self.refreshToken()
            } else {
                const keys = Object.keys(auth.data)
                for (let i = 0; i < keys.length; i++) {
                    self[keys[i]] = auth.data[keys[i]]
                }
                await self.saveSession()
            }
        } else {
            logger.log(`${self.log_prefix}Токен устарел`)
            await self.getToken()
        }
    }
    
    /**
     * Возвращает сохраненный в сессионной БД объект текущей сессии с токеном
     *
     * @returns {Promise.<{}>}
     */
    async getSession () {
        const response = await this.cacher.get(process.env.APP_ID + '_session') || "[]"
        let session = {}
        try {
            session = JSON.parse(response)
        } catch (err) {
            logger.error(err)
        }
        const keys = Object.keys(session)
        for (let i = 0; i < keys.length; i++) {
            this[keys[i]] = session[keys[i]]
        }
        return session
    }
    
    /**
     * Сохраняет объект текущей сессии с токеном в сессионной БД
     *
     * @returns {Promise.<void>}
     */
    async saveSession () {
        const sessionData = {
            token: this.token,
            user: this.user,
            exp: this.exp,
            iat: this.iat,
            expired: this.expired,
            minutes_to_expire: this.minutes_to_expire
        }
        await this.cacher.set(process.env.APP_ID + '_session', JSON.stringify(sessionData))
    }
    
    /**
     * Стартует периодические запуски проверки токена
     *
     * @returns {Promise.<void>}
     */
    async startChecking () {
        const num = parseInt(process.env.TOKEN_CHECK_INTERVAL || '1', 10)
        logger.log(`${this.log_prefix}Стартуем периодические проверки  ${plural(num, `каждую ${num} минуту`, `каждые ${num} минуты`, `каждые ${num} минут`)}`)
        setInterval(this.checkToken, num * 60 * 1000, this)
    }
}

module.exports = ewgVKBotSession
