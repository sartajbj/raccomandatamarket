'use strict';

/* =========================================================
   RaccomandataMarket.com
   Main Decoder Application
   V4.3: numeric prefixes + verified postal-operator patterns
   ========================================================= */

(() => {
  const CONFIG = {
    databaseUrl: "./codes.json",
    minDigits: 2,
    maxDigits: 20
  };

  let database = null;
  let codes = {};
  let sortedPrefixes = [];

  const $ = (selector, context = document) =>
    context.querySelector(selector);

  const $$ = (selector, context = document) =>
    Array.from(context.querySelectorAll(selector));

  function escapeHTML(value = '') {
    return String(value).replace(/[&<>"']/g, (char) => {
      const entities = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      };

      return entities[char];
    });
  }

  function normalizeRawCode(value = '') {
    return String(value)
      .trim()
      .toUpperCase()
      .replace(/[\s\-./]+/g, '');
  }

  function normalizeNumericCode(value = '') {
    return normalizeRawCode(value).replace(/\D/g, '');
  }

  function isValidNumericCode(code) {
    return (
      /^\d+$/.test(code) &&
      code.length >= CONFIG.minDigits &&
      code.length <= CONFIG.maxDigits
    );
  }

  /* =========================================================
     VERIFIED OPERATOR PATTERNS
     ========================================================= */

  function findOperatorPattern(rawCode) {
    const value = normalizeRawCode(rawCode);

    /*
     * Fulmine Group:
     * R + 11 cifre.
     *
     * Il codice identifica la spedizione e l'operatore,
     * non permette di conoscere con certezza il mittente
     * o il contenuto della raccomandata.
     */
    if (/^R\d{11}$/.test(value)) {
      return {
        operator: 'Fulmine Group',
        code: value,
        label: 'Raccomandata Fulmine Group',
        type: 'Raccomandata gestita da operatore postale privato',
        category: 'Operatore postale privato',
        confidence: 'alta',

        possibleSenders: [
          'Mittente non determinabile dal solo codice di spedizione',
          'Aziende, enti pubblici, banche o altri clienti che utilizzano Fulmine Group'
        ],

        possibleContents: [
          'Il codice identifica la spedizione, non il contenuto della busta',
          'Può trattarsi di documenti o comunicazioni di natura diversa'
        ],

        nextStep:
          'Il codice è riconducibile a una raccomandata gestita da Fulmine Group. Usa il codice completo nel servizio ufficiale di tracciabilità Fulmine Group e ritira la comunicazione nel punto indicato sull’avviso. Dal solo codice non è possibile stabilire con certezza il mittente o il contenuto.'
      };
    }

    return null;
  }

  /* =========================================================
     DATABASE
     ========================================================= */

  async function loadDatabase() {
    try {
      const response = await fetch(CONFIG.databaseUrl, {
        cache: 'no-cache'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (
        !data ||
        typeof data !== 'object' ||
        !data.codes ||
        typeof data.codes !== 'object'
      ) {
        throw new Error('Formato database non valido');
      }

      database = data;
      codes = data.codes;

      /*
       * I prefissi più lunghi vengono controllati per primi.
       *
       * Esempio:
       * 6970 deve avere priorità su 697.
       */
      sortedPrefixes = Object.keys(codes).sort(
        (a, b) => b.length - a.length
      );

      document.dispatchEvent(
        new CustomEvent('raccomandataDatabaseReady', {
          detail: {
            totalCodes: sortedPrefixes.length,
            lastUpdated: database.lastUpdated || null,
            version: database.version || null
          }
        })
      );

      renderCodeDirectory();

      return true;
    } catch (error) {
      console.error(
        'Impossibile caricare il database dei codici:',
        error
      );

      showDatabaseError();

      return false;
    }
  }

  function findCodeMatch(inputCode) {
    if (!inputCode || !sortedPrefixes.length) {
      return null;
    }

    const matchedPrefix = sortedPrefixes.find((prefix) =>
      inputCode.startsWith(prefix)
    );

    if (!matchedPrefix) {
      return null;
    }

    return {
      prefix: matchedPrefix,
      data: codes[matchedPrefix]
    };
  }

  /* =========================================================
     ELEMENT DETECTION
     ========================================================= */

  function getElements() {
    return {
      form:
        $('#decoderForm') ||
        $('#codeForm') ||
        $('[data-decoder-form]'),

      input:
        $('#trackingCode') ||
        $('#codeInput') ||
        $('#raccomandataCode') ||
        $('[data-code-input]'),

      button:
        $('#identifyButton') ||
        $('#decodeButton') ||
        $('[data-identify-button]'),

      result:
        $('#result') ||
        $('#decoderResult') ||
        $('[data-decoder-result]'),

      directory:
        $('#codeDirectory') ||
        $('[data-code-directory]'),

      directorySearch:
        $('#directorySearch') ||
        $('[data-directory-search]')
    };
  }

  /* =========================================================
     RESULT UI
     ========================================================= */

  function getResultContainer() {
    const elements = getElements();

    if (elements.result) {
      return elements.result;
    }

    if (!elements.form) {
      return null;
    }

    const result = document.createElement('section');

    result.id = 'decoderResult';
    result.className = 'decoder-result';
    result.setAttribute('aria-live', 'polite');

    elements.form.insertAdjacentElement(
      'afterend',
      result
    );

    return result;
  }

  function setResult(html, state = '') {
    const result = getResultContainer();

    if (!result) {
      return;
    }

    result.innerHTML = html;
    result.hidden = false;

    result.classList.remove(
      'is-success',
      'is-error',
      'is-warning',
      'is-loading'
    );

    if (state) {
      result.classList.add(`is-${state}`);
    }
  }

  function hideResult() {
    const result = getResultContainer();

    if (!result) {
      return;
    }

    result.hidden = true;
    result.innerHTML = '';

    result.classList.remove(
      'is-success',
      'is-error',
      'is-warning',
      'is-loading'
    );
  }

  function scrollToResult() {
    const result = getResultContainer();

    if (!result || result.hidden) {
      return;
    }

    if (window.innerWidth <= 768) {
      window.setTimeout(() => {
        result.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest'
        });
      }, 80);
    }
  }

  function renderList(items, emptyText) {
    if (!Array.isArray(items) || !items.length) {
      return `
        <p class="result-empty">
          ${escapeHTML(emptyText)}
        </p>
      `;
    }

    return `
      <ul class="result-list">
        ${items
          .map(
            (item) => `
              <li>${escapeHTML(item)}</li>
            `
          )
          .join('')}
      </ul>
    `;
  }

  function confidenceLabel(value) {
    const labels = {
      indicativa: 'Indicativa',
      media: 'Media',
      alta: 'Alta'
    };

    return labels[value] || 'Indicativa';
  }

  /* =========================================================
     NUMERIC CODE RESULT
     ========================================================= */

  function renderKnownResult(inputCode, match) {
    const item = match.data || {};

    const label =
      item.label || `Codice ${match.prefix}`;

    const type =
      item.type || 'Raccomandata';

    const category =
      item.category || 'Comunicazione';

    const senders = renderList(
      item.possibleSenders,
      'Mittente non determinabile dal solo codice.'
    );

    const contents = renderList(
      item.possibleContents,
      'Contenuto non determinabile dal solo codice.'
    );

    const nextStep =
      item.nextStep ||
      'Controlla le informazioni presenti sull’avviso di giacenza e ritira la raccomandata per conoscere il contenuto effettivo.';

    const confidence =
      confidenceLabel(item.confidence);

    setResult(
      `
        <div class="result-card">

          <div class="result-top">

            <div>

              <span class="result-eyebrow">
                Codice riconosciuto
              </span>

              <h2 class="result-title">
                ${escapeHTML(label)}
              </h2>

              <p class="result-subtitle">
                Identificazione orientativa basata sul prefisso
                <strong>${escapeHTML(match.prefix)}</strong>.
              </p>

            </div>

            <div class="result-code-box">

              <span>
                Codice inserito
              </span>

              <strong>
                ${escapeHTML(inputCode)}
              </strong>

            </div>

          </div>

          <div class="result-summary-grid">

            <div class="result-summary-item">

              <span>
                Tipologia
              </span>

              <strong>
                ${escapeHTML(type)}
              </strong>

            </div>

            <div class="result-summary-item">

              <span>
                Categoria
              </span>

              <strong>
                ${escapeHTML(category)}
              </strong>

            </div>

            <div class="result-summary-item">

              <span>
                Attendibilità
              </span>

              <strong>
                ${escapeHTML(confidence)}
              </strong>

            </div>

          </div>

          <div class="result-details">

            <section class="result-section">

              <h3>
                Possibili mittenti
              </h3>

              ${senders}

            </section>

            <section class="result-section">

              <h3>
                Possibile contenuto
              </h3>

              ${contents}

            </section>

          </div>

          <div class="result-next-step">

            <h3>
              Cosa fare adesso
            </h3>

            <p>
              ${escapeHTML(nextStep)}
            </p>

          </div>

          <div class="result-disclaimer">

            <strong>
              Importante:
            </strong>

            ${escapeHTML(
              database?.disclaimer ||
                'L’identificazione è indicativa e non consente di determinare con certezza il mittente o il contenuto della raccomandata.'
            )}

          </div>

          <p class="official-tracking-note">

            Per verificare lo stato effettivo della spedizione,
            utilizza il servizio ufficiale di tracciamento di
            Poste Italiane quando il codice appartiene a Poste.

          </p>

          <button
            type="button"
            class="new-search-button"
            data-new-search
          >

            Controlla un altro codice

          </button>

        </div>
      `,
      'success'
    );

    scrollToResult();
  }

  /* =========================================================
     OPERATOR RESULT — FULMINE GROUP
     ========================================================= */

  function renderOperatorResult(operatorResult) {
    const senders = renderList(
      operatorResult.possibleSenders,
      'Mittente non determinabile dal solo codice.'
    );

    const contents = renderList(
      operatorResult.possibleContents,
      'Contenuto non determinabile dal solo codice.'
    );

    setResult(
      `
        <div class="result-card">

          <div class="result-top">

            <div>

              <span class="result-eyebrow">
                Operatore identificato
              </span>

              <h2 class="result-title">
                ${escapeHTML(operatorResult.label)}
              </h2>

              <p class="result-subtitle">

                Il formato del codice è compatibile con

                <strong>
                  ${escapeHTML(operatorResult.operator)}
                </strong>.

              </p>

            </div>

            <div class="result-code-box">

              <span>
                Codice inserito
              </span>

              <strong>
                ${escapeHTML(operatorResult.code)}
              </strong>

            </div>

          </div>

          <div class="result-summary-grid">

            <div class="result-summary-item">

              <span>
                Operatore
              </span>

              <strong>
                ${escapeHTML(operatorResult.operator)}
              </strong>

            </div>

            <div class="result-summary-item">

              <span>
                Tipologia
              </span>

              <strong>
                ${escapeHTML(operatorResult.type)}
              </strong>

            </div>

            <div class="result-summary-item">

              <span>
                Attendibilità operatore
              </span>

              <strong>
                ${escapeHTML(
                  confidenceLabel(
                    operatorResult.confidence
                  )
                )}
              </strong>

            </div>

          </div>

          <div class="result-details">

            <section class="result-section">

              <h3>
                Possibile mittente
              </h3>

              ${senders}

            </section>

            <section class="result-section">

              <h3>
                Cosa indica il codice
              </h3>

              ${contents}

            </section>

          </div>

          <div class="result-next-step">

            <h3>
              Cosa fare adesso
            </h3>

            <p>
              ${escapeHTML(operatorResult.nextStep)}
            </p>

          </div>

          <div class="result-disclaimer">

            <strong>
              Importante:
            </strong>

            Il formato del codice permette di riconoscere
            l’operatore postale, ma non consente di conoscere
            con certezza il mittente o il contenuto della busta.

          </div>

          <p class="official-tracking-note">

            Per questo codice utilizza la tracciabilità ufficiale
            di Fulmine Group, non il tracking Poste Italiane.

          </p>

          <button
            type="button"
            class="new-search-button"
            data-new-search
          >

            Controlla un altro codice

          </button>

        </div>
      `,
      'success'
    );

    scrollToResult();
  }

  /* =========================================================
     UNKNOWN RESULT
     ========================================================= */

  function renderUnknownResult(inputCode) {
    setResult(
      `
        <div class="result-card result-card-unknown">

          <span class="result-eyebrow">
            Codice non presente nel database
          </span>

          <h2 class="result-title">
            Nessuna corrispondenza trovata
          </h2>

          <p>

            Il codice

            <strong>
              ${escapeHTML(inputCode)}
            </strong>

            non corrisponde attualmente a uno dei prefissi
            o formati riconosciuti dal nostro database.

          </p>

          <div class="result-next-step">

            <h3>
              Cosa significa?
            </h3>

            <p>

              Non significa che la raccomandata non sia valida.
              Il codice potrebbe appartenere a una categoria non
              ancora classificata oppure a un altro operatore
              postale.

              Per evitare informazioni errate, non proviamo
              a indovinare il mittente.

            </p>

          </div>

          <p class="official-tracking-note">

            Controlla attentamente il codice riportato
            sull’avviso di giacenza e utilizza il servizio
            ufficiale dell’operatore indicato sull’avviso.

          </p>

          <button
            type="button"
            class="new-search-button"
            data-new-search
          >

            Prova un altro codice

          </button>

        </div>
      `,
      'warning'
    );

    scrollToResult();
  }

  /* =========================================================
     VALIDATION
     ========================================================= */

  function renderValidationError(message) {
    setResult(
      `
        <div class="result-card result-card-error">

          <span class="result-eyebrow">
            Controlla il codice
          </span>

          <h2 class="result-title">
            Codice non valido
          </h2>

          <p>
            ${escapeHTML(message)}
          </p>

        </div>
      `,
      'error'
    );
  }

  function showDatabaseError() {
    const result = getResultContainer();

    if (!result) {
      return;
    }

    setResult(
      `
        <div class="result-card result-card-error">

          <span class="result-eyebrow">
            Servizio temporaneamente non disponibile
          </span>

          <h2 class="result-title">
            Database non disponibile
          </h2>

          <p>

            Non è stato possibile caricare il database dei
            codici. Ricarica la pagina e riprova.

          </p>

        </div>
      `,
      'error'
    );
  }

  /* =========================================================
     DECODER
     ========================================================= */

  function decodeInput(rawValue) {
    const rawNormalized =
      normalizeRawCode(rawValue);

    if (!rawNormalized) {
      renderValidationError(
        'Inserisci il codice riportato sull’avviso di giacenza.'
      );

      return;
    }

    /*
     * Prima controlliamo eventuali operatori postali
     * riconoscibili dal formato.
     */
    const operatorResult =
      findOperatorPattern(rawNormalized);

    if (operatorResult) {
      renderOperatorResult(operatorResult);

      return;
    }

    /*
     * Se contiene lettere ma non corrisponde a un formato
     * verificato, non lo trasformiamo artificialmente
     * in un codice numerico.
     */
    if (/[A-Z]/.test(rawNormalized)) {
      renderValidationError(
        'Formato alfanumerico non ancora riconosciuto. Controlla il codice completo e l’operatore indicato sull’avviso.'
      );

      return;
    }

    const normalized =
      normalizeNumericCode(rawNormalized);

    if (normalized.length < CONFIG.minDigits) {
      renderValidationError(
        'Inserisci almeno le prime 2 cifre del codice della raccomandata.'
      );

      return;
    }

    if (!isValidNumericCode(normalized)) {
      renderValidationError(
        'Il codice numerico deve contenere da 2 a 20 cifre. Spazi, trattini, punti e barre vengono rimossi automaticamente.'
      );

      return;
    }

    if (!database) {
      renderValidationError(
        'Il database dei codici non è ancora disponibile. Ricarica la pagina e riprova.'
      );

      return;
    }

    const match =
      findCodeMatch(normalized);

    if (!match) {
      renderUnknownResult(normalized);

      return;
    }

    renderKnownResult(
      normalized,
      match
    );
  }

  function handleSubmit(event) {
    event.preventDefault();

    const { input } =
      getElements();

    if (!input) {
      return;
    }

    decodeInput(
      input.value
    );
  }

  function resetDecoder() {
    const { input } =
      getElements();

    hideResult();

    if (input) {
      input.value = '';

      input.focus();

      if (
        typeof input.scrollIntoView ===
        'function'
      ) {
        input.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }
    }
  }

  /* =========================================================
     INPUT UX
     ========================================================= */

  function setupInput() {
    const { input } =
      getElements();

    if (!input) {
      return;
    }

    /*
     * Text input required because we now support:
     *
     * - numeric raccomandata codes
     * - Fulmine Group R + 11 digit codes
     */
    input.setAttribute(
      'inputmode',
      'text'
    );

    input.setAttribute(
      'autocomplete',
      'off'
    );

    input.setAttribute(
      'spellcheck',
      'false'
    );

    input.setAttribute(
      'autocapitalize',
      'characters'
    );

    input.addEventListener(
      'input',
      () => {
        const cleaned =
          input.value.replace(
            /[^A-Za-z0-9\s\-./]/g,
            ''
          );

        if (input.value !== cleaned) {
          input.value = cleaned;
        }
      }
    );

    input.addEventListener(
      'paste',
      () => {
        window.setTimeout(() => {
          input.value =
            input.value.replace(
              /[^A-Za-z0-9\s\-./]/g,
              ''
            );
        }, 0);
      }
    );
  }

  /* =========================================================
     SEARCHABLE CODE DIRECTORY
     ========================================================= */

  function createDirectoryCard(
    prefix,
    item
  ) {
    const possibleSenders =
      Array.isArray(
        item.possibleSenders
      ) &&
      item.possibleSenders.length
        ? item.possibleSenders
            .slice(0, 3)
            .join(', ')
        : 'Mittente variabile';

    return `
      <article
        class="code-directory-card"
        data-code-card
        data-prefix="${escapeHTML(prefix)}"
        data-search="${escapeHTML(
          [
            prefix,
            item.label || '',
            item.type || '',
            item.category || '',
            ...(item.possibleSenders || []),
            ...(item.possibleContents || [])
          ]
            .join(' ')
            .toLowerCase()
        )}"
      >

        <div class="code-directory-number">
          ${escapeHTML(prefix)}
        </div>

        <div class="code-directory-content">

          <h3>
            ${escapeHTML(
              item.label ||
                `Codice ${prefix}`
            )}
          </h3>

          <p class="code-directory-type">

            ${escapeHTML(
              item.type ||
                'Raccomandata'
            )}

          </p>

          <p>

            <strong>
              Possibili mittenti:
            </strong>

            ${escapeHTML(
              possibleSenders
            )}

          </p>

          <button
            type="button"
            class="code-check-button"
            data-check-code="${escapeHTML(prefix)}"
          >

            Controlla codice
            ${escapeHTML(prefix)}

          </button>

        </div>

      </article>
    `;
  }

  function renderCodeDirectory() {
    const { directory } =
      getElements();

    if (
      !directory ||
      !database
    ) {
      return;
    }

    const prefixes =
      Object.keys(codes).sort(
        (a, b) => {
          const numberA =
            Number(a);

          const numberB =
            Number(b);

          if (
            Number.isFinite(numberA) &&
            Number.isFinite(numberB)
          ) {
            return numberA - numberB;
          }

          return a.localeCompare(
            b,
            'it'
          );
        }
      );

    directory.innerHTML =
      prefixes
        .map(
          (prefix) =>
            createDirectoryCard(
              prefix,
              codes[prefix]
            )
        )
        .join('');

    updateDirectoryCount(
      prefixes.length
    );
  }

  function updateDirectoryCount(
    count
  ) {
    const counter =
      $('#directoryCount') ||
      $('[data-directory-count]');

    if (!counter) {
      return;
    }

    counter.textContent =
      String(count);
  }

  function filterDirectory(query) {
    const normalizedQuery =
      String(query || '')
        .trim()
        .toLowerCase();

    const cards =
      $$('[data-code-card]');

    let visible = 0;

    cards.forEach(
      (card) => {
        const searchable =
          card.getAttribute(
            'data-search'
          ) || '';

        const prefix =
          card.getAttribute(
            'data-prefix'
          ) || '';

        const matches =
          !normalizedQuery ||
          searchable.includes(
            normalizedQuery
          ) ||
          prefix.startsWith(
            normalizedQuery
          );

        card.hidden =
          !matches;

        if (matches) {
          visible += 1;
        }
      }
    );

    updateDirectoryCount(
      visible
    );

    const empty =
      $('#directoryEmpty') ||
      $('[data-directory-empty]');

    if (empty) {
      empty.hidden =
        visible !== 0;
    }
  }

  function setupDirectorySearch() {
    const {
      directorySearch
    } = getElements();

    if (!directorySearch) {
      return;
    }

    directorySearch.addEventListener(
      'input',
      () => {
        filterDirectory(
          directorySearch.value
        );
      }
    );
  }

  /* =========================================================
     GLOBAL ACTIONS
     ========================================================= */

  function setupGlobalActions() {
    document.addEventListener(
      'click',
      (event) => {
        const newSearchButton =
          event.target.closest(
            '[data-new-search]'
          );

        if (newSearchButton) {
          resetDecoder();

          return;
        }

        const codeButton =
          event.target.closest(
            '[data-check-code]'
          );

        if (codeButton) {
          const prefix =
            codeButton.getAttribute(
              'data-check-code'
            );

          const { input } =
            getElements();

          if (input) {
            input.value =
              prefix;
          }

          decodeInput(
            prefix
          );

          const form =
            $('#decoderForm') ||
            $('[data-decoder-form]');

          if (form) {
            form.scrollIntoView({
              behavior: 'smooth',
              block: 'start'
            });
          }
        }
      }
    );
  }

  /* =========================================================
     NAVIGATION
     ========================================================= */

  function setupNavigation() {
    const menuButton =
      $('#menuButton') ||
      $('[data-menu-button]');

    const navigation =
      $('#mainNav') ||
      $('[data-main-nav]');

    if (
      !menuButton ||
      !navigation
    ) {
      return;
    }

    menuButton.addEventListener(
      'click',
      () => {
        const expanded =
          menuButton.getAttribute(
            'aria-expanded'
          ) === 'true';

        menuButton.setAttribute(
          'aria-expanded',
          String(!expanded)
        );

        navigation.classList.toggle(
          'is-open',
          !expanded
        );
      }
    );

    navigation.addEventListener(
      'click',
      (event) => {
        if (
          !event.target.closest('a')
        ) {
          return;
        }

        menuButton.setAttribute(
          'aria-expanded',
          'false'
        );

        navigation.classList.remove(
          'is-open'
        );
      }
    );
  }

  /* =========================================================
     INITIALIZATION
     ========================================================= */

  async function init() {
    const elements =
      getElements();

    if (elements.result) {
      elements.result.hidden =
        true;

      elements.result.setAttribute(
        'aria-live',
        'polite'
      );
    }

    if (elements.form) {
      elements.form.addEventListener(
        'submit',
        handleSubmit
      );
    } else if (
      elements.button
    ) {
      elements.button.addEventListener(
        'click',
        () => {
          const { input } =
            getElements();

          if (input) {
            decodeInput(
              input.value
            );
          }
        }
      );
    }

    setupInput();
    setupDirectorySearch();
    setupGlobalActions();
    setupNavigation();

    await loadDatabase();
  }

  if (
    document.readyState ===
    'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      init,
      {
        once: true
      }
    );
  } else {
    init();
  }

  /* =========================================================
     PUBLIC API
     ========================================================= */

  window.RaccomandataMarket = {
    decode(value) {
      decodeInput(value);
    },

    normalize(value) {
      return normalizeRawCode(
        value
      );
    },

    find(value) {
      const raw =
        normalizeRawCode(
          value
        );

      const operatorResult =
        findOperatorPattern(
          raw
        );

      if (operatorResult) {
        return {
          operator: true,
          data: operatorResult
        };
      }

      if (
        /[A-Z]/.test(raw) ||
        !database
      ) {
        return null;
      }

      const normalized =
        normalizeNumericCode(
          raw
        );

      if (!normalized) {
        return null;
      }

      return findCodeMatch(
        normalized
      );
    },

    reset() {
      resetDecoder();
    }
  };
})();
