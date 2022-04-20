'use strict'

const logger = require('justewg-common/utils/logger')();

// Создаем объект обработчика очереди задач, запускаем
try {
    ;(async () => {
        try {
            const WorkersRunner = require('./workers')

            const worker = new WorkersRunner()
            await worker.run()
        } catch (e) {
            logger.error(e)
        }
    })()
} catch (e) {
    logger.error(e)
}
