// Простое хранение выбранной персоны на чат
const selectedPersonaByChat = new Map();

function getPersona(chatId) {
  return selectedPersonaByChat.get(chatId) || 'love_oracle'; // дефолт — любовь
}
function setPersona(chatId, key) {
  selectedPersonaByChat.set(chatId, key);
}

module.exports = { getPersona, setPersona };
