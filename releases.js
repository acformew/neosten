/* ============================================================
   ВСЕ РЕЛИЗЫ САЙТА. Правь ТОЛЬКО этот файл — сайт соберётся сам.

   Как это работает:
   • date в будущем        -> трек автоматически попадает в окно «скоро»
                              с обратным отсчётом и кнопкой пресейва (presave).
                              В день релиза он САМ переезжает в «новое».
   • самый свежий date     -> «новое» (если дата уже наступила)
   • plays (число)         -> «популярное», сортировка по числу прослушиваний
   • pick:true             -> «выбор артиста» (порядок как в списке)
   • file                  -> путь к аудио (папка audio/). Без file будет ссылка url.
   • cover:'img/x.jpg'     -> своя обложка (иначе рисуется типографская)
   • hide:true             -> в «скоро» название прячется за чёрной плашкой
   • match:'название'       -> как только на Apple Music появится релиз с таким названием,
                              запись сама получит обложку/дату/ссылки и покажет настоящее имя
   ============================================================ */
window.RELEASES = [
  // --- новое ---
  { id:'diss', title:'ДИСС НА НЕФОРОВ', type:'сингл', date:'2026-10-20',   // <- поставь реальную дату релиза
    file:'audio/diss-na-neforov.m4a' },

  // --- скоро (пример: замени или удали) ---
  { id:'next', title:'???', hide:true, type:'сингл', date:'2026-12-31T18:00',
    presave:'#' },                                                          // <- сюда ссылку на пресейв

  // --- популярное ---
  { id:'oshibka', title:'я ошибка музыки', plays:2100000, file:'audio/ya-oshibka-muzyki.mp3' },
  { id:'prygay',  title:'прыгай',          plays:1700000, file:'audio/prygay.mp3' },
  { id:'tri',     title:'три буквы',       plays:300000,  file:'audio/tri-bukvy.m4a' },

  // --- выбор артиста ---
  { id:'snova',   title:'СНОВА',      pick:true, file:'audio/snova.m4a' },
  { id:'locked',  title:'LOCKED',     pick:true, note:'', file:'audio/locked.m4a' },   // в файле было «сати» — можно дописать note:'feat. сати'
  { id:'pochemu', title:'ПОЧЕМУ',     pick:true, file:'audio/pochemu.m4a' },
  { id:'antag',   title:'АНТАГОНИСТ', pick:true, file:'audio/antagonist.m4a' }
];

window.ARTIST = {
  genre: '—',                                   // <- жанр
  bio:   'Здесь будет текст про neosten.'       // <- пара абзацев об артисте
};

/* Контакты и площадки. Пустое значение (booking:'') = «появится позже». */
window.LINKS = {
  social: [
    { n:'Telegram-канал', u:'https://t.me/neostenoff' },
    { n:'TikTok',         u:'https://www.tiktok.com/@neostenoff' },
    { n:'Группа VK',      u:'https://vk.com/neost33n' },
    { n:'YouTube',        u:'https://youtube.com/@neosten' }
  ],
  listen: [
    { k:'apple',   n:'Apple Music',   u:'https://music.apple.com/ru/artist/neosten/1802667747' },
    { k:'spotify', n:'Spotify',       u:'https://open.spotify.com/artist/5qNk6kVsCQa8fKahWEn9hc' },
    { k:'yandex',  n:'Яндекс Музыка', u:'https://music.yandex.ru/artist/23866894' },
    { k:'vk',      n:'VK Музыка',     u:'https://vk.ru/artist/3880687667394172596' }
  ],
  beats: [
    { n:'Сати — битмейкер', u:'https://t.me/svvvtv' },
    { n:'Биты Сати',        u:'https://t.me/prodbysative' }
  ],
  booking: ''
};
