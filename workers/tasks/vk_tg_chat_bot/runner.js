'use strict';

const logger = require('justewg-common/utils/logger')();
const workerpool = require('workerpool')

const clientsClass = require('../../../classes/clients')
const sessionClass = require('../../../classes/session')


let ctx = { session: {} }


require('dotenv').config()


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

    if (!args.hasOwnProperty('client_id') || !args.client_id) {
        logger.error('Неправильно задан проект')
        return false
    }
    
    const client = await (new clientsClass()).get(ctx, args.client_id)

    if (client.success === true && client.data) {
        // TODO сделать более правильный разбор параметров и опций клиента из БД и передачи их в бота
        args = Object.assign(args, client.data, client.data.options)
    
        const botClass = require('../../../classes/bot')
        this.bot = new botClass(Object.assign({id: args.client_id}, args))

        // TODO проверить на корректность задания номера порта
        this.bot.setServer(ctx, args.port || parseInt(process.env.PORT, 10) + args.idx)
        await this.bot.setImporter({
            ctx: ctx,
            interval: client.data.options.import_interval || 1,
            getter_url: args.getter_url
        })
        await this.bot.setCallBacks()
    } else {
        logger.error('Неправильно задан проект')
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
