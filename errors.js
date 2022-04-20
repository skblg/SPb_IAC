const errors = [
    // App
    {status: 101, message: "Чатбот-бэкенд уже запущен"},
    
    // Users
    {status: 424, message: "Пользователь не найден"},
    
    // Запросы к АПИ
    {status: 1001, message: "Новые обращения не найдены"},
    
    // VK Bot API
    {status: 1101, message: "Ошибка Long Polling"},
    {status: 1102, message: "Ошибка отправки сообщения"},
    {status: 1103, message: "Токен VK не указан"},
    {status: 1104, message: "Неопознанная ошибка bot.use()"},
    
    // Redis Client
    {status: 1201, message: "Ошибка записи в Redis"},
    {status: 1202, message: "Не указан Redis-client"},
    
    // Request
    {status: 1501, message: "Ошибка парсинга ответа от API"},
]

module.exports.getByCode = (code) => {
    const ret = errors.filter(err => err.status === code)
    return ret[0] || null
}