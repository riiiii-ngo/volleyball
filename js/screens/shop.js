/**
 * ショップ(アイテム)画面。#/shop で表示する。ショップ商品マスタの商品を並べ、「購入」で所持アイテムに加える。
 * 今は無料(currency_type = free)の商品だけ買える。有料の商品はボタンを押せない。
 */
(function () {
  'use strict';

  const esc = VolleyballUI.escapeHtml;

  function priceHtml(s) {
    if (s.isFree) return '<span class="shop-price is-free">無料</span>';
    return '<span class="shop-price"><b>' + s.price.toLocaleString() + '</b> ' + esc(s.currencyLabel) + '</span>';
  }

  // 商品の説明(効果のあるアイテムだけ)
  function effectText(item) {
    if (item.type === 'exp_ticket') return '使うと選手が経験値を' + item.effectValue + '獲得(選手育成で使用)';
    return '';
  }

  function cardHtml(s, i) {
    const effect = effectText(s.item);
    return '<li class="shop-card' + (s.isFree ? ' is-free' : '') + '" style="animation-delay:' + Math.min(i, 12) * 50 + 'ms">' +
      '<div class="shop-card-main">' +
        '<span class="shop-type">' + esc(s.item.typeLabel) + '</span>' +
        '<span class="shop-name">' + esc(s.item.name) + (s.quantity > 1 ? ' <small>×' + s.quantity.toLocaleString() + '</small>' : '') + '</span>' +
        (effect ? '<span class="shop-effect">' + esc(effect) + '</span>' : '') +
        (s.item.type === 'coin' ? '' : '<span class="shop-owned">所持 <b data-item="' + esc(s.item.id) + '">' + s.item.count + '</b></span>') +
      '</div>' +
      '<div class="shop-card-buy">' +
        priceHtml(s) +
        '<button type="button" class="shop-buy-btn" data-id="' + esc(s.id) + '"' + (s.canBuy ? '' : ' disabled') + '>購入</button>' +
      '</div>' +
    '</li>';
  }

  VolleyballApp.register('shop', {
    mount(el, args, app) {
      el.classList.add('menu-screen', 'roster-screen', 'shop-screen');
      el.innerHTML =
        '<header class="menu-header">' +
          '<button type="button" class="roster-back">‹ ショップ</button>' +
          '<h1 class="menu-heading">' +
            '<span class="menu-heading-en">ITEMS</span>' +
            '<span class="menu-heading-ja">アイテム</span>' +
          '</h1>' +
        '</header>' +
        '<main class="menu-content roster-content"><p class="roster-status">LOADING</p></main>';

      el.querySelector('.roster-back').addEventListener('click', () => app.go('menu', ['shop']));
      const content = el.querySelector('.roster-content');
      let disposed = false;
      let busy = false;

      VolleyballData.getShopItems().then(list => {
        if (disposed) return;
        content.innerHTML =
          '<p class="training-hint">今は無料の商品だけ購入できます。</p>' +
          '<ul class="shop-list">' + list.map(cardHtml).join('') + '</ul>';
        content.querySelectorAll('.shop-buy-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            if (busy) return;
            busy = true;
            VolleyballData.buyShopItem(btn.dataset.id).then(item => {
              if (disposed) return;
              content.querySelectorAll('[data-item="' + CSS.escape(item.id) + '"]').forEach(b => { b.textContent = item.count; });
              app.toast(item.name + 'を購入しました(所持 ' + item.count + ')');
            }).catch(err => app.toast(err.message)).then(() => { busy = false; });
          });
        });
      }).catch(err => {
        if (disposed) return;
        content.innerHTML = '<p class="roster-status is-error">' + esc(err.message) + '</p>';
      });

      return {
        unmount() { disposed = true; }
      };
    }
  });
})();
