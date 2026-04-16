    // PWA: Service Worker solo en contexto seguro (https o localhost)
    var isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if ('serviceWorker' in navigator && isSecure) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js')
          .then(function (reg) { console.log('PWA: Service Worker registrado', reg.scope); })
          .catch(function (err) { console.warn('PWA: Error al registrar SW', err); });
      });
    }

    // Banner "Instalar app" — visible al abrir el link; un toque para instalar o ver instrucciones
    (function () {
      var banner = document.getElementById('pwaInstallBanner');
      var installBtn = document.getElementById('pwaInstallBtn');
      var installText = document.getElementById('pwaInstallText');
      var installHint = document.getElementById('pwaInstallHint');
      var needServer = document.getElementById('pwaNeedServer');
      var closeBtn = document.getElementById('pwaInstallClose');
      var deferredPrompt = null;

      if (!banner) return;

      if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
        return;
      }

      if (closeBtn) closeBtn.addEventListener('click', function () { banner.classList.remove('show'); installHint.classList.remove('show'); sessionStorage.setItem('pwaBannerClosed', '1'); });

      function getInstallHint() {
        var ua = navigator.userAgent || '';
        if (/iPhone|iPad|iPod/i.test(ua)) return 'En el iPhone: tocá el botón Compartir (cuadrado con flecha abajo) y elegí "Añadir a pantalla de inicio".';
        if (/Android/i.test(ua)) {
          return 'En Android podés probar:\n' +
            '• En la barra de arriba (donde está la dirección), mirá si aparece un ícono de instalación (➕ o una pantalla con flecha) y tocá ahí.\n' +
            '• O tocá los 3 puntitos (⋮) del menú y buscá "Añadir a pantalla de inicio" o "Instalar aplicación".\n' +
            'Si no ves la opción, usá la página unos segundos y volvé a abrir el menú.';
        }
        return 'En Chrome o Edge: tocá los 3 puntitos (⋮) y buscá "Instalar Ferriol OS" o "Aplicaciones" → "Instalar esta aplicación".';
      }

      if (isSecure) {
        banner.classList.add('show');
        installBtn.style.display = '';
        needServer.style.display = 'none';
        window.addEventListener('beforeinstallprompt', function (e) {
          e.preventDefault();
          deferredPrompt = e;
          if (installHint) { installHint.classList.remove('show'); installHint.textContent = ''; }
        });
        if (installBtn) installBtn.addEventListener('click', function () {
          if (deferredPrompt) {
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then(function (choice) {
              if (choice.outcome === 'accepted') banner.classList.remove('show');
              deferredPrompt = null;
            });
          } else {
            if (installHint) { installHint.textContent = getInstallHint(); installHint.classList.add('show'); }
          }
        });
      } else {
        needServer.style.display = '';
        installBtn.style.display = 'none';
        installText.textContent = 'Para instalar la app no podés abrir el archivo directo.';
        if (installHint) installHint.style.display = 'none';
        banner.classList.add('show');
      }
    })();
