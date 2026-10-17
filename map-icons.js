// Inner SVG markup for a 24x24 viewBox; rendered with stroke="currentColor", fill="none".
// Ids are validated server-side as [a-z0-9-]{1,32}; unknown ids fall back to "question".
// Never rename or remove an id: categories and marks in the DB reference them.
window.MAP_ICON_GROUPS = [
  ['common', 'Общие'],
  ['anomaly', 'Аномалии и угрозы'],
  ['loot', 'Лут и ресурсы'],
  ['people', 'Люди и мутанты'],
  ['places', 'Места и постройки'],
  ['nature', 'Природа и ориентиры'],
];

window.MAP_ICONS = {
  // common
  question: { group: 'common', label: 'Вопрос', svg: '<circle cx="12" cy="12" r="10"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7"/><circle cx="12" cy="17" r=".6"/>' },
  pin: { group: 'common', label: 'Метка', svg: '<path d="M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>' },
  flag: { group: 'common', label: 'Флаг', svg: '<path d="M5 21V3"/><path d="M5 4h13l-3 4 3 4H5"/>' },
  star: { group: 'common', label: 'Звезда', svg: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>' },
  info: { group: 'common', label: 'Информация', svg: '<circle cx="12" cy="12" r="10"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r=".6"/>' },
  quest: { group: 'common', label: 'Задание', svg: '<circle cx="12" cy="12" r="10"/><path d="M12 7v6"/><circle cx="12" cy="16.5" r=".6"/>' },
  target: { group: 'common', label: 'Цель', svg: '<circle cx="12" cy="12" r="8"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/>' },
  eye: { group: 'common', label: 'Наблюдение', svg: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>' },
  key: { group: 'common', label: 'Ключ', svg: '<circle cx="8" cy="12" r="4"/><path d="M12 12h10M18 12v4M21 12v3"/>' },
  lock: { group: 'common', label: 'Закрыто', svg: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><path d="M12 15v2"/>' },
  note: { group: 'common', label: 'Записка / документы', svg: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h6"/>' },
  clock: { group: 'common', label: 'Событие по времени', svg: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>' },
  safe: { group: 'common', label: 'Безопасная зона', svg: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>' },
  shield: { group: 'common', label: 'Защита', svg: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>' },

  // anomalies and threats
  anomaly: { group: 'anomaly', label: 'Аномалия', svg: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>' },
  radiation: { group: 'anomaly', label: 'Радиация', svg: '<circle cx="12" cy="12" r="10"/><path d="M12 12V3M12 12l7.8 4.5M12 12l-7.8 4.5"/>' },
  psi: { group: 'anomaly', label: 'Пси-излучение', svg: '<circle cx="12" cy="12" r="10"/><path d="M7 7.5v2.5a5 5 0 0 0 10 0V7.5M12 6v12"/>' },
  temperature: { group: 'anomaly', label: 'Температура', svg: '<path d="M10 4a2 2 0 0 1 4 0v10.5a4 4 0 1 1-4 0z"/><path d="M12 9v6.5"/><circle cx="12" cy="17.5" r="1.2"/>' },
  fire: { group: 'anomaly', label: 'Огонь / жар', svg: '<path d="M12 22a7 7 0 0 0 7-7c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-5 5-5 8a7 7 0 0 0 7 7z"/>' },
  cold: { group: 'anomaly', label: 'Холод', svg: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/><path d="M9.5 3.5L12 5l2.5-1.5M9.5 20.5L12 19l2.5 1.5"/>' },
  bio: { group: 'anomaly', label: 'Биоугроза', svg: '<circle cx="12" cy="7.5" r="4"/><circle cx="7.8" cy="14.8" r="4"/><circle cx="16.2" cy="14.8" r="4"/><circle cx="12" cy="12.4" r="1.4"/>' },
  chemical: { group: 'anomaly', label: 'Химия', svg: '<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7 15h10"/>' },
  acid: { group: 'anomaly', label: 'Кислота', svg: '<path d="M8 3s4 4.5 4 7.5a4 4 0 0 1-8 0C4 7.5 8 3 8 3z"/><path d="M17 11s3 3.3 3 5.5a3 3 0 0 1-6 0c0-2.2 3-5.5 3-5.5z"/>' },
  gas: { group: 'anomaly', label: 'Газ', svg: '<path d="M7 18a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 8.5a4.5 4.5 0 0 1 0 9.5z"/><path d="M9 21h6"/>' },
  electric: { group: 'anomaly', label: 'Электричество', svg: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>' },
  gravity: { group: 'anomaly', label: 'Гравитация', svg: '<path d="M10.5 11a1.5 1.5 0 0 1 3 0a3 3 0 0 1-6 0a4.5 4.5 0 0 1 9 0a6 6 0 0 1-12 0"/>' },
  emission: { group: 'anomaly', label: 'Выброс', svg: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>' },
  portal: { group: 'anomaly', label: 'Портал', svg: '<ellipse cx="12" cy="12" rx="6" ry="10"/><ellipse cx="12" cy="12" rx="3" ry="6"/>' },
  danger: { group: 'anomaly', label: 'Опасность', svg: '<path d="M12 3l10 18H2z"/><path d="M12 10v5"/><circle cx="12" cy="18" r=".6"/>' },
  mine: { group: 'anomaly', label: 'Мины', svg: '<circle cx="12" cy="15" r="6"/><path d="M12 9V5M8 10L6 7M16 10l2-3"/><path d="M4 21h16"/>' },
  explosion: { group: 'anomaly', label: 'Взрыв', svg: '<path d="M12 2l2 6 6-3-3 6 5 2-5 2 3 6-6-3-2 6-2-6-6 3 3-6-5-2 5-2-3-6 6 3z"/>' },
  skull: { group: 'anomaly', label: 'Смерть', svg: '<path d="M5 14a7 7 0 1 1 14 0v3H5z"/><circle cx="9.5" cy="12" r="1.3"/><circle cx="14.5" cy="12" r="1.3"/><path d="M9 17v3M12 17v3M15 17v3"/>' },

  // loot and resources
  bag: { group: 'loot', label: 'Лут', svg: '<path d="M5 8h14l1 13H4z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>' },
  cache: { group: 'loot', label: 'Тайник', svg: '<path d="M3 8l9-5 9 5v9l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v9"/>' },
  crate: { group: 'loot', label: 'Ящик', svg: '<rect x="3" y="5" width="18" height="15" rx="1"/><path d="M3 10h18M10 14h4"/>' },
  crystal: { group: 'loot', label: 'Кристалл', svg: '<path d="M9 3h6l4 5-7 13L5 8z"/><path d="M5 8h14M9 3l3 5 3-5M12 8v13"/>' },
  artifact: { group: 'loot', label: 'Артефакт', svg: '<path d="M12 4l5 8-5 8-5-8z"/><path d="M19 2v4M17 4h4M5 17v3M3.5 18.5h3"/>' },
  plant: { group: 'loot', label: 'Растения', svg: '<path d="M12 22V10"/><path d="M12 14c-4 0-7-3-7-8 4 0 7 3 7 8zM12 11c0-4 3-7 7-7 0 4-3 7-7 7z"/>' },
  ammo: { group: 'loot', label: 'Патроны', svg: '<path d="M6 21V10c0-3 1.5-6 1.5-6S9 7 9 10v11zM15 21V10c0-3 1.5-6 1.5-6S18 7 18 10v11z"/><path d="M6 17h3M15 17h3"/>' },
  medkit: { group: 'loot', label: 'Медицина', svg: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V4h6v3M12 10.5v6M9 13.5h6"/>' },
  fuel: { group: 'loot', label: 'Топливо', svg: '<path d="M5 6h9l4 4v11H5z"/><path d="M8 6V3h4v3M8.5 11l6 6M14.5 11l-6 6"/>' },
  battery: { group: 'loot', label: 'Энергия', svg: '<rect x="2" y="7" width="18" height="10" rx="2"/><path d="M22 11v2M6 10v4M10 10v4"/>' },
  trader: { group: 'loot', label: 'Торговец', svg: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5c0-1 1-1.5 2.5-1.5s2.5.7 2.5 1.8-1 1.4-2.5 1.8-2.5.8-2.5 1.9S10.5 16 12 16s2.5-.5 2.5-1.5"/>' },
  workshop: { group: 'loot', label: 'Мастерская', svg: '<path d="M14 4l6 6-3 3-6-6z"/><path d="M12.5 8.5L3 18l3 3 9.5-9.5"/>' },

  // people and mutants
  npc: { group: 'people', label: 'Персонаж', svg: '<circle cx="12" cy="7" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>' },
  enemy: { group: 'people', label: 'Враги', svg: '<path d="M3 3l11 11M21 3L10 14"/><path d="M12.5 17.5l5-5M6.5 12.5l5 5"/><path d="M16 16l4 4M8 16l-4 4"/>' },
  boss: { group: 'people', label: 'Босс', svg: '<path d="M3 18L2 7l5 4 5-7 5 7 5-4-1 11z"/><path d="M3 21h18"/>' },
  paw: { group: 'people', label: 'Звери', svg: '<circle cx="5.5" cy="10" r="1.8"/><circle cx="9.5" cy="6" r="1.8"/><circle cx="14.5" cy="6" r="1.8"/><circle cx="18.5" cy="10" r="1.8"/><path d="M12 11c-3 0-6 4.5-6 7a2.5 2.5 0 0 0 3.5 2.2c1.6-.6 3.4-.6 5 0A2.5 2.5 0 0 0 18 18c0-2.5-3-7-6-7z"/>' },
  claws: { group: 'people', label: 'Мутанты', svg: '<path d="M6 3c2 5 1.5 12-1.5 18M11.5 3c2 5 1.5 12-1.5 18M17 3c2 5 1.5 12-1.5 18"/>' },

  // places and buildings
  camp: { group: 'places', label: 'Лагерь', svg: '<path d="M2 20L12 4l10 16z"/><path d="M9 20l3-6 3 6"/>' },
  campfire: { group: 'places', label: 'Костёр', svg: '<path d="M4 21l16-4M20 21L4 17"/><path d="M12 15c2.5 0 4-1.5 4-4 0-2.5-2-4-3-7-1 2-2 2.5-2.5 4C9.5 7 9 6 8.5 5 7.5 7 8 9 8 11c0 2.5 1.5 4 4 4z"/>' },
  shelter: { group: 'places', label: 'Укрытие', svg: '<path d="M3 20a9 9 0 0 1 18 0z"/><path d="M10 20v-4h4v4"/>' },
  house: { group: 'places', label: 'Здание', svg: '<path d="M3 11l9-8 9 8"/><path d="M5 10v11h14V10"/>' },
  fort: { group: 'places', label: 'База', svg: '<path d="M4 21V8h3v2h3V8h4v2h3V8h3v13z"/><path d="M10 21v-5h4v5"/>' },
  checkpoint: { group: 'places', label: 'Блокпост', svg: '<path d="M3 21V9M3 11h18v4H3"/><path d="M8 11l-2 4M13 11l-2 4M18 11l-2 4"/>' },
  tower: { group: 'places', label: 'Вышка', svg: '<path d="M7 21l2-13h6l2 13"/><path d="M6 8h12M8 14h8M12 3v5"/>' },
  radio: { group: 'places', label: 'Радио / сигнал', svg: '<path d="M12 10v11M8 21h8"/><circle cx="12" cy="8" r="2"/><path d="M8.5 4.5a5 5 0 0 0 0 7M15.5 4.5a5 5 0 0 1 0 7M5.5 2a9 9 0 0 0 0 12M18.5 2a9 9 0 0 1 0 12"/>' },
  factory: { group: 'places', label: 'Завод', svg: '<path d="M2 21V12l5-3v3l5-3v3l5-3V3h3v18z"/><path d="M6 17h2M11 17h2"/>' },
  lab: { group: 'places', label: 'Лаборатория', svg: '<circle cx="12" cy="12" r="1.5"/><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-60 12 12)"/>' },
  church: { group: 'places', label: 'Церковь', svg: '<path d="M12 2v5M10 4h4"/><path d="M8 21V11l4-4 4 4v10"/><path d="M4 21v-6l4-2M20 21v-6l-4-2M2 21h20"/>' },
  grave: { group: 'places', label: 'Кладбище', svg: '<path d="M7 21V9a5 5 0 0 1 10 0v12"/><path d="M4 21h16M12 10v6M9.5 12.5h5"/>' },
  entrance: { group: 'places', label: 'Вход', svg: '<path d="M6 21V4h12v17"/><path d="M3 21h18"/><circle cx="14.5" cy="13" r=".7"/>' },
  stairs: { group: 'places', label: 'Спуск', svg: '<path d="M3 20h5v-5h5v-5h5V5h3"/>' },
  cave: { group: 'places', label: 'Пещера / тоннель', svg: '<path d="M3 20v-6a9 9 0 0 1 18 0v6"/><path d="M8 20v-5a4 4 0 0 1 8 0v5"/><path d="M2 20h20"/>' },
  bridge: { group: 'places', label: 'Мост', svg: '<path d="M2 10h20M4 10v10M20 10v10"/><path d="M4 20a8 6 0 0 1 16 0"/>' },
  car: { group: 'places', label: 'Транспорт', svg: '<path d="M3 16v-4l2-5h14l2 5v4z"/><circle cx="7" cy="17" r="1.8"/><circle cx="17" cy="17" r="1.8"/>' },
  train: { group: 'places', label: 'Железная дорога', svg: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M8 21l2-4M16 21l-2-4"/><circle cx="9" cy="14" r=".6"/><circle cx="15" cy="14" r=".6"/>' },

  // nature and landmarks
  water: { group: 'nature', label: 'Вода', svg: '<path d="M12 3s7 7 7 12a7 7 0 0 1-14 0c0-5 7-12 7-12z"/>' },
  forest: { group: 'nature', label: 'Лес', svg: '<path d="M12 2l6 9h-3l4 6H5l4-6H6z"/><path d="M12 17v5"/>' },
  hill: { group: 'nature', label: 'Возвышенность', svg: '<path d="M2 20l7-12 4 6 3-4 6 10z"/>' },
  compass: { group: 'nature', label: 'Ориентир', svg: '<circle cx="12" cy="12" r="10"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>' },
  exit: { group: 'nature', label: 'Переход', svg: '<path d="M4 12h14M13 6l6 6-6 6"/>' },
};

// <optgroup>s with every icon, for the category and personal-mark icon selects.
window.mapIconOptions = function (selected) {
  var icons = window.MAP_ICONS;
  return window.MAP_ICON_GROUPS.map(function (g) {
    var group = document.createElement('optgroup');
    group.label = g[1];
    Object.keys(icons).forEach(function (id) {
      if (icons[id].group !== g[0]) return;
      var opt = document.createElement('option');
      opt.value = id;
      opt.textContent = icons[id].label;
      if (id === selected) opt.selected = true;
      group.appendChild(opt);
    });
    return group;
  });
};
