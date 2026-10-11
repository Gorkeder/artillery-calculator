// Inner SVG markup for a 24x24 viewBox; rendered with stroke="currentColor", fill="none".
// Ids are validated server-side as [a-z0-9-]{1,32}; unknown ids fall back to "question".
window.MAP_ICONS = {
  question: { label: 'Вопрос', svg: '<circle cx="12" cy="12" r="10"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7"/><circle cx="12" cy="17" r=".6"/>' },
  cache: { label: 'Тайник', svg: '<path d="M3 8l9-5 9 5v9l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v9"/>' },
  trader: { label: 'Торговец', svg: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5c0-1 1-1.5 2.5-1.5s2.5.7 2.5 1.8-1 1.4-2.5 1.8-2.5.8-2.5 1.9S10.5 16 12 16s2.5-.5 2.5-1.5"/>' },
  danger: { label: 'Опасность', svg: '<path d="M12 3l10 18H2z"/><path d="M12 10v5"/><circle cx="12" cy="18" r=".6"/>' },
  radiation: { label: 'Радиация', svg: '<circle cx="12" cy="12" r="10"/><path d="M12 12V3M12 12l7.8 4.5M12 12l-7.8 4.5"/>' },
  entrance: { label: 'Вход', svg: '<path d="M6 21V4h12v17"/><path d="M3 21h18"/><circle cx="14.5" cy="13" r=".7"/>' },
  camp: { label: 'Лагерь', svg: '<path d="M2 20L12 4l10 16z"/><path d="M9 20l3-6 3 6"/>' },
  flag: { label: 'Флаг', svg: '<path d="M5 21V3"/><path d="M5 4h13l-3 4 3 4H5"/>' },
  star: { label: 'Звезда', svg: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>' },
  pin: { label: 'Метка', svg: '<path d="M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>' },
  eye: { label: 'Наблюдение', svg: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>' },
  key: { label: 'Ключ', svg: '<circle cx="8" cy="12" r="4"/><path d="M12 12h10M18 12v4M21 12v3"/>' },
  anomaly: { label: 'Аномалия', svg: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>' },
  bag: { label: 'Лут', svg: '<path d="M5 8h14l1 13H4z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>' },
  skull: { label: 'Смерть', svg: '<path d="M5 14a7 7 0 1 1 14 0v3H5z"/><circle cx="9.5" cy="12" r="1.3"/><circle cx="14.5" cy="12" r="1.3"/><path d="M9 17v3M12 17v3M15 17v3"/>' },
  target: { label: 'Цель', svg: '<circle cx="12" cy="12" r="8"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/>' },
  house: { label: 'Здание', svg: '<path d="M3 11l9-8 9 8"/><path d="M5 10v11h14V10"/>' },
  tower: { label: 'Вышка', svg: '<path d="M7 21l2-13h6l2 13"/><path d="M6 8h12M8 14h8M12 3v5"/>' },
  water: { label: 'Вода', svg: '<path d="M12 3s7 7 7 12a7 7 0 0 1-14 0c0-5 7-12 7-12z"/>' },
  car: { label: 'Транспорт', svg: '<path d="M3 16v-4l2-5h14l2 5v4z"/><circle cx="7" cy="17" r="1.8"/><circle cx="17" cy="17" r="1.8"/>' },
};
