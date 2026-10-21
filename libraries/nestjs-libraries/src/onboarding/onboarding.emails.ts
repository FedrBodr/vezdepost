export type OnboardingStep =
  | 'welcome'
  | 'no_channel_day1'
  | 'no_channel_day3'
  | 'first_post';

export type OnboardingMessage = {
  subject: string;
  html: string;
  /** Short plain-text version for the messenger assistant, no unsubscribe link. */
  botText: string;
};

const GUIDES = {
  telegram: 'https://vezdepost.ru/blog/otlozhennyj-post-v-telegram/',
  max: 'https://vezdepost.ru/blog/otlozhennyj-post-v-max/',
  vk: 'https://vezdepost.ru/blog/otlozhennye-posty-vk/',
};

const appUrl = () =>
  `${process.env.FRONTEND_URL || 'https://app.vezdepost.ru'}/launches`;

const paragraphs = (...items: string[]) =>
  items.map((item) => `<p>${item}</p>`).join('\n');

const link = (href: string, text: string) => `<a href="${href}">${text}</a>`;

const button = (href: string, text: string) =>
  `<a href="${href}" style="display:inline-block;padding:10px 18px;border-radius:6px;background:#612bd3;color:#ffffff;text-decoration:none;">${text}</a>`;

const unsubscribe = (url: string) =>
  `<p style="font-size:12px;color:#6b7280;">Не хотите получать такие письма-подсказки? ${link(
    url,
    'Отписаться'
  )}.</p>`;

/** The texts of the onboarding chain, one entry per step. */
export const onboardingMessage = (
  step: OnboardingStep,
  { unsubscribeUrl }: { unsubscribeUrl: string }
): OnboardingMessage => {
  const app = appUrl();
  const build = (subject: string, body: string, botText: string) => ({
    subject,
    html: `${body}\n${unsubscribe(unsubscribeUrl)}`,
    botText,
  });

  switch (step) {
    case 'welcome':
      return build(
        'Привет! Я Дмитрий, автор Vezdepost',
        paragraphs(
          'Здравствуйте!',
          'Я Дмитрий, делаю Vezdepost один, с помощью ИИ. Спасибо, что зарегистрировались.',
          'Vezdepost нужен, чтобы написать пост один раз и выпустить его в нужное время сразу в несколько соцсетей и мессенджеров.',
          'Проще всего начать с Telegram или MAX — подключение канала занимает около двух минут:',
          `${link(
            GUIDES.telegram,
            'Как подключить Telegram-канал'
          )}<br />${link(GUIDES.max, 'Как подключить канал в MAX')}`,
          link(app, 'Открыть Vezdepost'),
          'Если что-то не получится или чего-то не хватает — ответьте на это письмо, читаю сам.',
          'Дмитрий'
        ),
        `Привет! Я Дмитрий, автор Vezdepost. Проще всего начать с Telegram или MAX — подключение канала занимает около двух минут.\nИнструкция: ${GUIDES.telegram}\nОткрыть Vezdepost: ${app}`
      );
    case 'no_channel_day1':
      return build(
        'Подключите первый канал за 2 минуты',
        paragraphs(
          'Здравствуйте! Это снова Дмитрий из Vezdepost.',
          'В аккаунте пока нет ни одного канала, а без него публиковать некуда. Вот короткие инструкции — выберите, с чего удобнее начать:',
          `${link(GUIDES.telegram, 'Telegram-канал')}<br />${link(
            GUIDES.max,
            'Канал в MAX'
          )}<br />${link(GUIDES.vk, 'Сообщество ВКонтакте')}`,
          button(app, 'Открыть Vezdepost'),
          'Если застряли на каком-то шаге — ответьте на это письмо, читаю сам и помогу.',
          'Дмитрий'
        ),
        `В Vezdepost пока нет каналов. Подключить первый — около двух минут.\nИнструкция для Telegram: ${GUIDES.telegram}\nОткрыть Vezdepost: ${app}`
      );
    case 'no_channel_day3':
      return build(
        'Что-то не получилось?',
        paragraphs(
          'Здравствуйте!',
          'Вы зарегистрировались в Vezdepost несколько дней назад, но канал так и не подключили. Возможно, что-то пошло не так или оказалось непонятно.',
          'Напишите в ответ пару слов, что не получилось, — помогу разобраться. Читаю каждое письмо сам.',
          'Если сервис просто не подошёл, тоже напишите: так я пойму, что исправить.',
          'Дмитрий'
        ),
        `Что-то не получилось с подключением канала? Ответьте на моё письмо от Vezdepost — помогу разобраться.\nОткрыть Vezdepost: ${app}`
      );
    case 'first_post':
      return build(
        'Как запланировать первый пост',
        paragraphs(
          'Здравствуйте! Канал подключён, осталось запланировать первый пост. Это три шага:',
          `1. Откройте ${link(
            app,
            'календарь'
          )} и нажмите «Создать пост».<br />2. Выберите канал и напишите текст, при желании добавьте картинку.<br />3. Укажите дату и время и нажмите «Добавить в календарь».`,
          'Пост выйдет сам в указанное время. Ещё можно публиковать прямо из мессенджера: кнопка «Постить из Telegram» в верхней панели привязывает бота, и дальше достаточно отправить ему текст или фото и выбрать канал.',
          button(app, 'Открыть календарь'),
          'Если что-то пойдёт не так — ответьте на это письмо, читаю сам.',
          'Дмитрий'
        ),
        `Канал подключён — осталось запланировать первый пост: «Создать пост» в календаре, выбрать канал, указать время.\nОткрыть календарь: ${app}`
      );
  }
};
