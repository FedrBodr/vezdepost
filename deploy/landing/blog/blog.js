// Общий скрипт страниц блога.

// first-touch: откуда пришёл посетитель в первый раз. Тот же формат, что у
// лендинга (deploy/landing/index.html) и libraries/helpers/src/utils/first.touch.ts;
// по path (/blog/...) видно, что регистрация пришла из блога.
(function () {
  try {
    if (/(?:^|;\s*)vp_first_touch=/.test(document.cookie)) return;
    var params = new URLSearchParams(location.search);
    var utm = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) {
      var v = params.get(k);
      if (v) utm[k] = v.slice(0, 200);
    });
    var touch = {
      src: 'landing',
      ref: (document.referrer || '').slice(0, 500),
      path: (location.pathname + location.search).slice(0, 500),
      utm: utm,
      at: new Date().toISOString()
    };
    var domain = /(^|\.)vezdepost\.ru$/.test(location.hostname) ? '; domain=.vezdepost.ru' : '';
    document.cookie = 'vp_first_touch=' + encodeURIComponent(JSON.stringify(touch)) +
      '; path=/; max-age=15552000; samesite=lax' + domain +
      (location.protocol === 'https:' ? '; secure' : '');
  } catch (e) {}
})();

// конверсионные события в Метрику — те же цели, что на лендинге
document.addEventListener('click', function (e) {
  var a = e.target.closest ? e.target.closest('a') : null;
  if (!a || typeof ym === 'undefined') return;
  if (a.href.indexOf('app.vezdepost.ru') !== -1) ym(110559699, 'reachGoal', 'cta_app_click');
  else if (a.href.indexOf('github.com/FedrBodr') !== -1) ym(110559699, 'reachGoal', 'github_click');
  else if (a.href.indexOf('t.me/FedrBodr') !== -1) ym(110559699, 'reachGoal', 'tg_footer_click');
});
