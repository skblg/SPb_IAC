'use strict';

const logger = require('justewg-common/utils/logger')()
const plural = require('plural-ru');

const subscribesClass = require('../classes/subscribe')
const version = require('../package.json').version
const welcomeMessage = 'Привет. Я -- чатбот портала "Наш Санкт-Петербург" (v.' + version + ')'
const templates = require('../config/msg_templates')


module.exports = [
    // Старт общения с ботом
    {
        pattern: '^(/start|Начать)$',
        handler: async (ctx, self) => {
            const txt = `${welcomeMessage}\n`
                + `Мое назначение -- ${self.name}\n\n`
                + `Вы можете использовать эти текстовые команды для общения со мной:\n\n`
                + `  "/start" или "Начать" -- это сообщение\n\n`
                
                + `  "/subscribe" -- подписаться на все новые сообщения\n`
                + `  "/subscribe:daily" -- подписаться на дайджесты за сутки\n`
                + `  "/subscribe:clear" -- удалить текущую подписку\n\n`
                
                + `  "/digest" -- вывести дайджест за все время\n`
                + `  "/digest:daily" -- вывести дайджест за последние сутки\n`
                + `  "/digest:weekly" -- вывести дайджест за последнюю неделю\n\n`
                
                // + `  "/repeat_last:<N>" -- повторить N последних сообщений\n`
                + `  "/repeat_last" -- повторить последнее обращение\n`
            
            const response = await self.sendMessage(self.user.chat_id, txt)
            return {
                success: true,
                data: response
            }
        }
    },
    
    // Подписка на периодические сообщения
    {
        pattern: '^/subscribe:?(.*)$',
        handler: async (ctx, self, data, match) => {
            let result = {success: false}
            
            const _getSubscribeModeDef = (mode) => {
                switch (mode) {
                    case 'every':
                        return 'все сообщения по отдельности'
                        break;
                    case 'daily':
                        return 'суточные дайджесты'
                        break;
                }
                return ''
            }
            const mode = match[1] || ''
            let txt = ''
            
            // Определяем подписки в этой беседе этой группы этого чатбот-проекта
            let currentSubscribes = []
            logger.log(self.user)
            let args = {
                bot: self.id,
                chat: self.user.chat_id
            }
            if (self.type === 'vk_chat_bot') {
                args.group = self.group_id
            } else if (self.type === 'tg_chat_bot') {
            }

            const currentClientResponse = await self.getClient(ctx)
            args = {
                bot: currentClientResponse.data[0].id,
                chat: self.user.chat_id
            }
            if (self.type === 'vk_chat_bot') {
                args.group = self.group_id
            } else if (self.type === 'tg_chat_bot') {
            }

            const currentSubscribesResponse = await (new subscribesClass({log_prefix: self.log_prefix})).search(ctx, args)
            if (currentSubscribesResponse.success === true && currentSubscribesResponse.data.length > 0) {
                currentSubscribes = [new subscribesClass(Object.assign({log_prefix: this.log_prefix}, currentSubscribesResponse.data[0]))]
            }

            if (currentSubscribes.length > 0 && ['clear', 'delete', 'remove'].indexOf(mode) === -1) {
                txt = `Подписка на ${_getSubscribeModeDef(currentSubscribes[0].mode)} уже активна`
                result.success = true
                result.data = await self.sendMessage(self.user.chat_id, txt)
            } else if (match && match.length > 0) {
                const newData = {
                    bot: self.id, user: self.user.id, group: self.user.group_id || 1, chat: self.user.chat_id, mode: 'unknown'
                }
                logger.log(newData)
                switch (mode) {
                    case '':
                    case 'every':
                        // Отправляем запррос на добавление подписки в БД
                        result = await (new subscribesClass(Object.assign({log_prefix: self.log_prefix}, newData, { mode: 'every'}))).add(ctx)
                        if (result.success === true) {
                            txt = `Подписка на ${_getSubscribeModeDef('every')} установлена`
                        } else {
                            logger.error(result.error)
                            txt = 'Ошибка установки подписки'
                        }
                        break;
                    case 'daily':
                        // Отправляем запррос на добавление подписки в БД
                        result = await (new subscribesClass(Object.assign({log_prefix: self.log_prefix}, newData, { mode: 'daily'}))).add(ctx)
                        if (result.success === true) {
                            txt = `Подписка на ${_getSubscribeModeDef('daily')} установлена`
                        } else {
                            logger.error(result.error)
                            txt = 'Ошибка установки подписки'
                        }
                        break;
                    case 'clear':
                    case 'remove':
                    case 'delete':
                        // Отправляем запррос на удаление подписки из БД
                        result = await currentSubscribes[0].delete(ctx)
                        if (result.success === true) {
                            txt = 'Подписка удалена'
                        } else {
                            logger.error(result.error)
                            txt = 'Ошибка удаления подписки'
                        }
                        break;
                }
                if (result.success === true) {
                    result.data = await self.sendMessage(self.LogTelegramChatId, txt)
                }
            }
            
            return result
        }
    },
    
    // Дайджест за какой-либо из поддерживаемых периодов
    {
        pattern: '^/digest:?(.*)$',
        handler: async (ctx, self, data, match) => {
            let result = {success: false}
            let response
                let txt = ''
            if (match && match.length > 0) {
                const period = match[1] || ''
                switch (period) {
                    case '':
                        result.success = true
                        txt = 'Дайджест глобальный'
                        response = await self.getProblemsStat(ctx, 'global')
                        if (response.success === true) {
                            txt = templates.digest.compose(ctx, 'global', response.data)
                        }
                        break;
                    case 'daily':
                        result.success = true
                        txt = 'Дайджест за сутки'
                        response = await self.getProblemsStat(ctx, 'daily')
                        if (response.success === true) {
                            txt = templates.digest.compose(ctx, 'daily', response.data)
                        }
                        break;
                    case 'weekly':
                        result.success = true
                        txt = 'Дайджест за неделю'
                        response = await self.getProblemsStat(ctx, 'weekly')
                        if (response.success === true) {
                            txt = templates.digest.compose(ctx, 'weekly', response.data)
                        }
                        break;
                }
            }
            
            result.data = await self.sendMessage(self.user.chat_id, txt)
            
            return result
        }
    },
    
    // Повтор сообщения с последним(-и) обращением(-ями)
    {
        pattern: '^/repeat_last:?(.*)$',
        handler: async (ctx, self, data, match) => {
            let result = {success: false}
            let num = 0
            if (match && match.length > 0) {
                if (match[1] !== '') {
                    num = parseInt(match[1], 10)
                }
            }
    
            // Определяем подписки в этой беседе этой группы этого чатбот-проекта
            let currentSubscribes = []
            const currentSubscribesResponse = await (new subscribesClass({log_prefix: self.log_prefix})).search(ctx, {bot: self.id, group: self.group_id, chat: self.user.chat_id})
            if (currentSubscribesResponse.success === true && currentSubscribesResponse.data.length > 0) {
                currentSubscribes = [new subscribesClass(Object.assign({log_prefix: this.log_prefix}, currentSubscribesResponse.data[0]))]
            }
    
            // if (num > 0) {
            const lastIndex = await self.importer.getLastIndex()
            const problems = await self.importer.getter(ctx, self.importer, {after: lastIndex - 1})
            if (problems.success === true) {
                let message
                for (let i = 0; i < problems.data.length; i++) {
                    message = await self.importer.createMessage(problems.data[i], currentSubscribes[0])
                    await self.sendMessage(self.user.chat_id, message.body, message.attachments[0])
                }
            }
            result.success = true
            result.data = `Повтор ${num} ${plural(num, 'последнего сообщения', 'последних сообщений', 'последних сообщений')}`
            // }
            return result
        }
    },
]
