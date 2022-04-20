'use strict';

const moment = require('moment')


module.exports = {

    single_problem: {
        /**
         * Возвращает текст сообщения об отдельном обращении
         *
         * @param ctx - Контекст приложения
         * @param data - Данные для текста сообщения
         * @returns {string}
         */
        compose: (ctx, data) => {
            // Ссылка на миниапп-страницу обращения
            // const appLink = `https://vk.com/app${data.subscribe.app}_-${data.subscribe.group}#card=${data.p.id}`
            const appLink = `https://vk.com/app7710919_-198213785#card=${data.p.id}`
            const portalLink = `https://gorod.gov.spb.ru/problems/${data.p.id}`

            // Составляем текст сообщения
            if (data.bot_type === 'vk_chat_bot' ) {
                return `${moment(data.p.created_at).format('DD.MM.YYYY')}: ${data.p.reason.name}\n`
                    + `ID: ${data.p.id}\n\n`
                    + `${data.p.petition && data.p.petition.body || '--'}\n\n`
                    + `Дополнительная информация:\n${appLink}`
            } else {
                if (data.p.is_public === true) {
                    return '⌚' + `${moment(data.p.created_at).format('DD.MM.YYYY')} 🆔: ${data.p.id}\n<b>${data.p.reason.name}</b>\n\n`
                        + `${data.p.nearest_building ? data.p.nearest_building.short_address : (data.p.building ? data.p.building.short_address : '')}\n\n`
                        + `${data.p.petition && data.p.petition.body || '--'}\n\n`
                        + `Дополнительная информация:\n<a href="${portalLink}">${portalLink}</a>\n\n<a href="${appLink}">${appLink}</a>`
                } else {
                    return '⌚' + `${moment(data.p.created_at).format('DD.MM.YYYY')} 🆔: ${data.p.id}\n<b>${data.p.reason.name}</b>\n\n`
                        + `${data.p.nearest_building ? data.p.nearest_building.short_address : (data.p.building ? data.p.building.short_address : '')}\n\n`
                        + `Подробности скрыты модератором либо заявка принята по горячей линии 004.`
                }
            }
        }
    },
    
    digest: {
        /**
         * Возвращает текст сообщения с дайджестом обращений за последние сутки
         *
         * @param ctx - Контекст приложения
         * @param data - Данные для текста сообщения
         * @returns {string}
         */
        compose: (ctx, mode, data) => {
            let period = ''
            switch (mode) {
                case 'global':
                    period = 'все время'
                    break;
                case 'weekly':
                    period = 'последнюю неделю'
                    break;
                case 'daily':
                    period = 'последние сутки'
                    break;
            }
    
            // Составляем текст сообщения
            return `${moment().format('DD.MM.YYYY')}: Дайджест за ${period}:\n`
                + `Всего обращений: ${data.reduce((total, item) => total + (item.count || 0), 0)}\n`
                + `Завершено обращений: ${data.reduce((total, item) => total + (item.resolved || 0), 0)}\n`
        }
    }
}

