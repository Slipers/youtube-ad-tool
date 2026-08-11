/* ============================================================================
 * Fonctions injectées dans la page YouTube Studio.
 * Chacune doit rester autonome : executeScript n'envoie que son propre code.
 * ==========================================================================*/

function computeAverageGap() {
  function parseSeconds(value) {
    const parts = value.split(':').map(Number);
    if (parts.some((p) => Number.isNaN(p))) return null;
    if (parts.length === 4) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 3) return parts[0] * 60 + parts[1];
    return null;
  }

  const seconds = Array.from(document.querySelectorAll('.ad-break-row'))
    .map((row) => {
      const input =
        row.querySelector('.ad-break-framestamp-container input[type="text"]') ||
        row.querySelector('ytve-formatted-input input');
      return input && input.value ? parseSeconds(input.value) : null;
    })
    .filter((s) => s !== null)
    .sort((a, b) => a - b);

  if (seconds.length < 2) {
    return { count: seconds.length, averageGapSeconds: null };
  }

  let totalGap = 0;
  for (let i = 1; i < seconds.length; i++) {
    totalGap += seconds[i] - seconds[i - 1];
  }

  return { count: seconds.length, averageGapSeconds: totalGap / (seconds.length - 1) };
}

function removeInvalidAdBreaks() {
  function waitForRowCountBelow(previousCount, timeoutMs) {
    return new Promise((resolve) => {
      const start = performance.now();
      function check() {
        const currentCount = document.querySelectorAll('.ad-break-row').length;
        if (currentCount < previousCount || performance.now() - start > timeoutMs) {
          resolve();
        } else {
          requestAnimationFrame(check);
        }
      }
      requestAnimationFrame(check);
    });
  }

  return new Promise(async (resolve) => {
    window.__ytAdToolStop = false;
    let removed = 0;
    while (true) {
      if (window.__ytAdToolStop) break;

      const previousCount = document.querySelectorAll('.ad-break-row').length;
      const warningIcon = document.querySelector('.ad-break-row .warning-icon');
      const row = warningIcon ? warningIcon.closest('.ad-break-row') : null;
      if (!row) break;

      const deleteButton = row.querySelector('.delete-button');
      if (!deleteButton) break;

      deleteButton.click();
      removed++;
      await waitForRowCountBelow(previousCount, 2000);
    }
    resolve(removed);
  });
}

function removeAllAdBreaks() {
  function waitForRowCountBelow(previousCount, timeoutMs) {
    return new Promise((resolve) => {
      const start = performance.now();
      function check() {
        const currentCount = document.querySelectorAll('.ad-break-row').length;
        if (currentCount < previousCount || performance.now() - start > timeoutMs) {
          resolve();
        } else {
          requestAnimationFrame(check);
        }
      }
      requestAnimationFrame(check);
    });
  }

  return new Promise(async (resolve) => {
    window.__ytAdToolStop = false;
    let removed = 0;
    while (true) {
      if (window.__ytAdToolStop) break;

      const previousCount = document.querySelectorAll('.ad-break-row').length;
      const row = document.querySelector('.ad-break-row');
      if (!row) break;

      const deleteButton = row.querySelector('.delete-button');
      if (!deleteButton) break;

      deleteButton.click();
      removed++;
      await waitForRowCountBelow(previousCount, 2000);
    }
    resolve(removed);
  });
}

function convertAutoAdBreaksToManual() {
  return new Promise(async (resolve) => {
    const panel = document.querySelector('ytve-ad-breaks-editor-options-panel');
    if (!panel || typeof panel.editAutoMidroll !== 'function') {
      resolve({ error: 'panel-not-found', converted: 0 });
      return;
    }

    const adBreaks = panel.adBreaks || [];
    const autoCount = adBreaks.filter((b) => b.type === 'auto').length;
    if (autoCount === 0) {
      resolve({ converted: 0 });
      return;
    }

    const autoIndex = adBreaks.findIndex((b) => b.type === 'auto');
    panel.editAutoMidroll(autoIndex);

    function waitForOkButton(timeoutMs) {
      return new Promise((res) => {
        const start = performance.now();
        function check() {
          const btn = Array.from(document.querySelectorAll('button[aria-label="OK"]')).find(
            (b) => b.offsetParent !== null
          );
          if (btn || performance.now() - start > timeoutMs) {
            res(btn || null);
          } else {
            requestAnimationFrame(check);
          }
        }
        check();
      });
    }

    const okButton = await waitForOkButton(3000);
    if (okButton) {
      okButton.click();
    }

    resolve({ converted: autoCount, confirmed: !!okButton });
  });
}

/* ---------------------------------------------------------------------------
 * Ajout d'emplacements : on écrit l'horodatage dans le champ de l'éditeur puis
 * on clique sur son bouton d'insertion. Le mode « silence » s'appuie sur la
 * forme d'onde que l'éditeur publie déjà, aucune lecture n'est nécessaire.
 * -------------------------------------------------------------------------*/

function insertAdBreaks(mode, params) {
  return new Promise(async (resolve) => {
    const MARGIN = 30;
    const MAX_INSERTS = 500;

    window.__ytAdToolStop = false; // remis à zéro à chaque lancement

    function delay(ms) {
      return new Promise((r) => setTimeout(r, ms));
    }

    function adRows() {
      return Array.from(document.querySelectorAll('.ad-break-row'));
    }

    function rowInput(row) {
      return (
        row.querySelector('.ad-break-framestamp-container input[type="text"]') ||
        row.querySelector('ytve-formatted-input input') ||
        row.querySelector('input')
      );
    }

    function parseSeconds(value) {
      const parts = value.split(':').map(Number);
      if (parts.some((p) => Number.isNaN(p))) return null;
      if (parts.length === 4) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 3) return parts[0] * 60 + parts[1];
      return null;
    }

    function existingSeconds() {
      return adRows()
        .map((row) => {
          const input = rowInput(row);
          return input && input.value ? parseSeconds(input.value) : null;
        })
        .filter((s) => s !== null);
    }

    function formatTimestamp(seconds, useHours) {
      const total = Math.max(0, Math.round(seconds));
      const pad = (n) => String(n).padStart(2, '0');
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      return useHours ? `${h}:${pad(m)}:${pad(s)}:00` : `${pad(m)}:${pad(s)}:00`;
    }

    function getDurationSeconds() {
      const markers = document.querySelector('ytve-timeline-markers');
      const projection = markers && markers.getAttribute('projection');
      if (projection) {
        try {
          const parsed = JSON.parse(projection.replace(/&quot;/g, '"'));
          if (parsed && parsed.maximumMs) return Math.floor(parsed.maximumMs / 1000);
        } catch (e) { /* attribut illisible : on passe au repli */ }
      }
      const video = document.querySelector('video');
      if (video && isFinite(video.duration) && video.duration > 1) return Math.floor(video.duration);
      return null;
    }

    function getWaveform() {
      const el = document.querySelector('ytve-audio-waveform');
      if (!el || !el.audioWaveformData) return null;
      const data = Array.from(el.audioWaveformData);
      if (data.length < 10) return null;
      return { data, durationMs: el.audioDurationMs || null };
    }

    function findInsertControls() {
      const button =
        document.querySelector('ytcp-button[test-id="insert-ad-slot"]') ||
        document.getElementById('add-ad-break');

      let input =
        document.querySelector('#container > input[type="text"]') ||
        document.querySelector('#container > input');

      let node = button ? button.parentElement : null;
      for (let i = 0; i < 3 && node && !input; i++) {
        input = node.querySelector(':scope > input[type="text"], :scope > * > input[type="text"]');
        node = node.parentElement;
      }

      return { button, input };
    }

    function setNativeValue(input, value) {
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      if (desc && desc.set) desc.set.call(input, value);
      else input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }

    function waitForRowCount(target, timeoutMs) {
      return new Promise((done) => {
        const start = performance.now();
        function check() {
          if (adRows().length >= target) return done(true);
          if (performance.now() - start > timeoutMs) return done(false);
          requestAnimationFrame(check);
        }
        check();
      });
    }

    async function insertAt(times, useHours) {
      const { button, input } = findInsertControls();
      if (!button || !input) return { inserted: 0, skipped: 0, reason: 'no-editor' };

      let inserted = 0;
      let skipped = 0;
      let misses = 0;

      for (const t of times) {
        // Drapeau posé par le bouton « Arrêter » du popup.
        if (window.__ytAdToolStop) return { inserted, skipped, stopped: true };

        const before = adRows().length;
        setNativeValue(input, formatTimestamp(t, useHours));
        await delay(20);
        button.click();

        if (await waitForRowCount(before + 1, 1500)) {
          inserted++;
          misses = 0;
        } else {
          skipped++;
          misses++;
          if (misses >= 5) return { inserted, skipped, reason: 'editor-stalled' };
        }
        await delay(40);
      }

      return { inserted, skipped };
    }

    // Un silence = une suite d'échantillons sous une fraction du niveau moyen.
    function findSilences(data, durationMs, levelPercent, minSilenceSeconds) {
      const mean = data.reduce((sum, v) => sum + Math.abs(v), 0) / data.length;
      const threshold = mean * (levelPercent / 100);
      const msPerSample = durationMs / data.length;

      const runs = [];
      let start = null;
      for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i]) <= threshold) {
          if (start === null) start = i;
        } else if (start !== null) {
          runs.push([start, i - 1]);
          start = null;
        }
      }
      if (start !== null) runs.push([start, data.length - 1]);

      return runs
        .filter(([a, b]) => ((b - a + 1) * msPerSample) / 1000 >= minSilenceSeconds)
        .map(([a, b]) => (((a + b) / 2) * msPerSample) / 1000);
    }

    function spread(times, duration, minGap, taken) {
      const kept = [];
      const all = taken.slice();
      times.forEach((t) => {
        if (t < MARGIN || t > duration - MARGIN) return;
        if (all.some((s) => Math.abs(s - t) < minGap)) return;
        kept.push(Math.round(t));
        all.push(t);
      });
      return kept;
    }

    if (!findInsertControls().button) {
      resolve({ error: 'no-editor' });
      return;
    }

    let duration = getDurationSeconds();
    let targets = [];
    let extra = {};

    if (mode === 'silence') {
      const waveform = getWaveform();
      if (!waveform) {
        resolve({ error: 'no-waveform' });
        return;
      }

      const durationMs = waveform.durationMs || (duration ? duration * 1000 : null);
      if (!durationMs) {
        resolve({ error: 'no-duration' });
        return;
      }
      duration = duration || Math.floor(durationMs / 1000);

      const midpoints = findSilences(
        waveform.data,
        durationMs,
        params.levelPercent,
        params.minSilenceSeconds
      );
      targets = spread(midpoints, duration, params.minGapSeconds, existingSeconds());
      extra = { silences: midpoints.length };
    } else {
      if (!duration) {
        resolve({ error: 'no-duration' });
        return;
      }
      const step = params.intervalSeconds;
      const raw = [];
      for (let t = Math.max(step, MARGIN); t <= duration - MARGIN; t += step) raw.push(t);
      targets = spread(raw, duration, Math.min(step, 5), existingSeconds());
    }

    /* Pré-roll et end-roll sortent volontairement des marges de sécurité :
     * ce sont les extrémités exactes de la vidéo. YouTube peut les refuser,
     * auquel cas la boucle d'insertion les compte comme refusés et continue. */
    const edges = [];
    if (params.preRoll) edges.push(0);
    if (params.endRoll && duration) edges.push(Math.max(1, duration - 1));

    const taken = existingSeconds();
    const extraEdges = edges.filter((t) => !taken.some((s) => Math.abs(s - t) < 2));
    if (extraEdges.length) {
      targets = [...new Set([...extraEdges, ...targets])].sort((a, b) => a - b);
    }

    const truncated = targets.length > MAX_INSERTS;
    targets = targets.slice(0, MAX_INSERTS);

    if (targets.length === 0) {
      resolve({ inserted: 0, targets: 0, duration, error: 'no-target', ...extra });
      return;
    }

    const result = await insertAt(targets, duration >= 3600);

    resolve({
      inserted: result.inserted,
      skipped: result.skipped,
      stopped: !!result.stopped,
      targets: targets.length,
      truncated,
      duration,
      reason: result.reason,
      ...extra,
    });
  });
}

/* ---------------------------------------------------------------------------
 * Réduction : ne garde qu'un emplacement par créneau visé (fréquence choisie
 * ou nombre total voulu), en préférant les candidats sans avertissement.
 * -------------------------------------------------------------------------*/

function reduceAdBreaks(params) {
  return new Promise(async (resolve) => {
    window.__ytAdToolStop = false;

    function parseSeconds(value) {
      const parts = value.split(':').map(Number);
      if (parts.some((p) => Number.isNaN(p))) return null;
      if (parts.length === 4) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 3) return parts[0] * 60 + parts[1];
      return null;
    }

    function rowInput(row) {
      return (
        row.querySelector('.ad-break-framestamp-container input[type="text"]') ||
        row.querySelector('ytve-formatted-input input') ||
        row.querySelector('input')
      );
    }

    function getDurationSeconds() {
      const markers = document.querySelector('ytve-timeline-markers');
      const projection = markers && markers.getAttribute('projection');
      if (projection) {
        try {
          const parsed = JSON.parse(projection.replace(/&quot;/g, '"'));
          if (parsed && parsed.maximumMs) return Math.floor(parsed.maximumMs / 1000);
        } catch (e) { /* repli sur la balise vidéo */ }
      }
      const video = document.querySelector('video');
      if (video && isFinite(video.duration) && video.duration > 1) return Math.floor(video.duration);
      return null;
    }

    function waitForRowCountBelow(previousCount, timeoutMs) {
      return new Promise((res) => {
        const start = performance.now();
        function check() {
          const currentCount = document.querySelectorAll('.ad-break-row').length;
          if (currentCount < previousCount || performance.now() - start > timeoutMs) {
            res();
          } else {
            requestAnimationFrame(check);
          }
        }
        requestAnimationFrame(check);
      });
    }

    const rows = Array.from(document.querySelectorAll('.ad-break-row'))
      .map((row) => {
        const input = rowInput(row);
        if (!input || !input.value) return null;
        return {
          value: input.value,
          seconds: parseSeconds(input.value),
          hasWarning: !!row.querySelector('.warning-icon'),
        };
      })
      .filter(Boolean);

    if (rows.length === 0) {
      resolve({ kept: 0, removed: 0, total: 0 });
      return;
    }

    // Les lignes dont l'horodatage est illisible sont toujours conservées.
    const validRows = rows.filter((r) => r.seconds !== null);
    const keepValues = new Set(rows.filter((r) => r.seconds === null).map((r) => r.value));

    if (validRows.length > 0) {
      const lastTime = Math.max(...validRows.map((r) => r.seconds));
      const duration = getDurationSeconds() || lastTime;
      const targets = [];
      let spacing;

      if (params.mode === 'count') {
        const count = Math.max(1, params.count);
        spacing = duration / (count + 1);
        for (let i = 1; i <= count; i++) targets.push(spacing * i);
      } else {
        spacing = params.interval;
        for (let t = spacing; t <= lastTime + spacing / 2; t += spacing) targets.push(t);
        if (targets.length === 0) targets.push(lastTime);
      }

      const tolerance = spacing * 0.6;
      const warningPenalty = 15;
      const used = new Set();

      for (const target of targets) {
        let bestIdx = null;
        let bestCost = Infinity;
        validRows.forEach((r, idx) => {
          if (used.has(idx)) return;
          const dist = Math.abs(r.seconds - target);
          if (dist > tolerance) return;
          const cost = dist + (r.hasWarning ? warningPenalty : 0);
          if (cost < bestCost) {
            bestCost = cost;
            bestIdx = idx;
          }
        });
        if (bestIdx !== null) {
          used.add(bestIdx);
          keepValues.add(validRows[bestIdx].value);
        }
      }
    }

    let removed = 0;
    let stopped = false;
    while (true) {
      if (window.__ytAdToolStop) {
        stopped = true;
        break;
      }

      const currentRows = Array.from(document.querySelectorAll('.ad-break-row'));
      const previousCount = currentRows.length;
      const rowToDelete = currentRows.find((row) => {
        const input = rowInput(row);
        return input && input.value && !keepValues.has(input.value);
      });
      if (!rowToDelete) break;

      const deleteButton = rowToDelete.querySelector('.delete-button');
      if (!deleteButton) break;

      deleteButton.click();
      removed++;
      await waitForRowCountBelow(previousCount, 2000);
    }

    resolve({ kept: keepValues.size, removed, total: rows.length, stopped });
  });
}

/* ---------------------------------------------------------------------------
 * Pilotage des boutons de YouTube Studio : « Continuer » (fenêtre des
 * emplacements), « Enregistrer » (page Revenus) et « Vérifier le placement
 * des mid-rolls ». Chaque bouton est cherché par test-id, puis par identifiant,
 * puis par libellé (fr/en), y compris à l'intérieur des shadow DOM.
 * -------------------------------------------------------------------------*/

function studioAction(action) {
  return new Promise((resolve) => {
    function deepAll(selector, root = document, out = [], seen = new Set()) {
      if (seen.has(root)) return out;
      seen.add(root);
      out.push(...root.querySelectorAll(selector));
      root.querySelectorAll('*').forEach((el) => {
        if (el.shadowRoot) deepAll(selector, el.shadowRoot, out, seen);
      });
      return out;
    }

    function usable(el) {
      if (!el || !el.isConnected) return false;
      if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
      return true;
    }

    function labelOf(el) {
      return ((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || ''))
        .replace(/\s+/g, ' ')
        .trim();
    }

    function findButton(selectors, patterns) {
      for (const selector of selectors) {
        const direct = deepAll(selector).find(usable);
        if (direct) return direct;
      }
      const buttons = deepAll('ytcp-button, ytve-button, tp-yt-paper-button, button').filter(usable);
      for (const pattern of patterns) {
        const match = buttons.find((b) => pattern.test(labelOf(b)));
        if (match) return match;
      }
      return null;
    }

    const CONTINUE = {
      selectors: ['ytcp-button[test-id="continue-button"]', '#continue-button'],
      patterns: [/^continuer$/i, /^continue$/i],
    };

    const SAVE = {
      selectors: [
        'ytcp-button[test-id="save-button"]',
        'ytcp-button#save-button',
        '#save-button',
        'ytcp-button#save',
        '#save',
      ],
      patterns: [/^enregistrer$/i, /^save$/i],
    };

    const VERIFY = {
      selectors: ['ytcp-button[test-id="check-midroll-placement"]'],
      patterns: [
        /v[ée]rifier le placement/i,
        /placement des mid-?rolls/i,
        /check .*mid-?roll/i,
        /mid-?roll placement/i,
      ],
    };

    function durationSeconds() {
      const markers = document.querySelector('ytve-timeline-markers');
      const projection = markers && markers.getAttribute('projection');
      if (projection) {
        try {
          const parsed = JSON.parse(projection.replace(/&quot;/g, '"'));
          if (parsed && parsed.maximumMs) return Math.floor(parsed.maximumMs / 1000);
        } catch (e) { /* repli sur la balise vidéo */ }
      }
      const video = document.querySelector('video');
      if (video && isFinite(video.duration) && video.duration > 1) return Math.floor(video.duration);
      return null;
    }

    // La confusion la plus fréquente : lancer l'outil pendant l'envoi de la
    // vidéo, alors qu'il ne fonctionne qu'une fois publiée, depuis l'onglet
    // Monétisation. On repère la fenêtre d'envoi/traitement par son URL et
    // ses éléments propres, absents une fois la vidéo publiée.
    function isUploadFlow() {
      if (/\/videos\/upload(\/|$|\?)/i.test(location.pathname + location.search)) return true;
      return !!document.querySelector(
        'ytcp-uploads-dialog, ytcp-uploads-details, ytcp-video-upload-progress, #video-upload-dialog'
      );
    }

    if (action === 'probe') {
      resolve({
        rows: document.querySelectorAll('.ad-break-row').length,
        warnings: document.querySelectorAll('.ad-break-row .warning-icon').length,
        editorOpen: !!document.querySelector('.ad-break-row, ytve-ad-breaks-editor-options-panel'),
        hasContinue: !!findButton(CONTINUE.selectors, CONTINUE.patterns),
        hasSave: !!findButton(SAVE.selectors, SAVE.patterns),
        hasVerify: !!findButton(VERIFY.selectors, VERIFY.patterns),
        duration: durationSeconds(),
        uploading: isUploadFlow(),
      });
      return;
    }

    const config = action === 'continue' ? CONTINUE : action === 'save' ? SAVE : VERIFY;
    const button = findButton(config.selectors, config.patterns);

    if (!button) {
      resolve({ ok: false, reason: 'not-found' });
      return;
    }

    button.click();
    resolve({ ok: true });
  });
}

/* ============================================================================
 * Popup
 * ==========================================================================*/

// Les versions 0.x étaient des bêtas ; à partir de la 1.0 on nomme autrement.
function versionLabel(version) {
  return String(version).startsWith('0.') ? `Bêta ${version}` : `Version ${version}`;
}

/* Compare deux numéros de version façon « 1.0.2 ». Renvoie 1 si a > b. */
function compareVersions(a, b) {
  const left = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const right = String(b).split('.').map((n) => parseInt(n, 10) || 0);

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function formatInterval(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m} min`;
  return `${m} min ${s}s`;
}

const APP_VERSION = '1.3';

// Dépôt public : sert au contrôle de version et au téléchargement.
const REPO_OWNER = 'Slipers';
const REPO_NAME = 'youtube-ad-tool';
const UPDATE_MANIFEST_URL =
  `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/version.json`;
const RELEASES_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

// Le libellé « Nouveau » n'est rendu que sur l'entrée la plus récente.
const CHANGELOG = [
  {
    version: '1.3',
    date: '11 août 2026',
    tag: 'Nouveau',
    items: [
      'Nouvelle icône',
      'Description du manifeste raccourcie sous la limite du Chrome Web Store (132 caractères)',
    ],
  },
  {
    version: '1.2',
    date: '10 août 2026',
    tag: 'Nouveau',
    items: [
      'Correction : l\'annonce de sortie de bêta se redéclenchait à chaque mise à jour, toujours avec le texte figé sur « 1.0 »',
      'Elle ne se joue plus qu\'une seule fois dans la vie de l\'installation, et affiche la version réellement installée',
    ],
  },
  {
    version: '1.1',
    date: '10 août 2026',
    tag: 'Nouveau',
    items: [
      'Mise à jour installée par l\'extension elle-même : plus besoin de télécharger et remplacer à la main',
      'Le dossier n\'est désigné qu\'une fois, l\'autorisation est ensuite mémorisée',
      'Téléchargement complet avant écriture : une coupure réseau ne laisse pas l\'extension à moitié mise à jour',
    ],
  },
  {
    version: '1.0',
    date: '10 août 2026',
    items: [
      'Première version stable : l\'extension sort de bêta',
      'Mise à jour vérifiée au démarrage depuis GitHub, avec téléchargement direct',
      'Nouvelles options du mode auto : pub pré-roll à 0:00 et pub end-roll en fin de vidéo',
    ],
  },
  {
    version: '0.9Bis',
    date: '29 juillet 2026',
    items: [
      'Onglet Auto réorganisé : Démarrer et les étapes remontés tout en haut',
      'Étapes recentrées, plus de débordement sur les bords',
      'Réglages de remplissage regroupés dans l\'engrenage, affichés selon la méthode choisie',
      'Chaque section a désormais ses propres couleurs : curseurs, boutons et badges suivent le dégradé de l\'onglet',
      'Nouvelle option « Sauvegarder automatiquement quand terminé », et conversion des pubs auto sortie de l\'engrenage',
      'Intervalle du mode Régulier plafonné à 10 min, écart minimum : 30 s ajouté, 5 min retiré',
      'Fin du mode auto fêtée : confettis, coche verte animée et durée totale, avec durée réglable côté développeur',
      'Le bouton d\'écart moyen fait défiler jusqu\'au résultat, sans survol parasite',
      'Coche animée et confettis à la fin de chaque action, pas seulement du mode auto',
      'Profil avec niveau, XP et temps gagné, visible dans l\'onglet Outils',
      'Pastilles glissantes sur les onglets et les groupes de choix',
      'Temps restant estimé une seule fois au départ, pour tout le parcours',
      'Bulle d\'aide au survol du « ? » de la sauvegarde automatique',
      'Toutes les étapes passent au vert une fois le parcours terminé',
      'Mention Bêta retirée de l\'onglet Silence, l\'avertissement reste',
      'Nouvelle interface développeur : réafficher l\'avertissement, régler la pause du mode auto',
      'Temps restant estimé à partir de la vitesse réelle, plus d\'une constante',
      'Bulle d\'aide recentrée : elle ne déborde plus de l\'interface',
      'Avertissement si le mode auto est lancé pendant l\'envoi de la vidéo plutôt qu\'après publication',
    ],
  },
  {
    version: '0.9',
    date: '29 juillet 2026',
    items: [
      'Mode automatique réactivé et complet, de bout en bout',
      'Choix de la méthode de remplissage : Régulier ou Silence (forme d\'onde)',
      'Épinglage déclenché automatiquement au lancement',
      'Pause de 20 s affichée en grand, puis Continuer et Enregistrer automatiques',
      'Rechargement de la page et réouverture des emplacements sans intervention',
      'Avancement en 4 étapes avec temps restant estimé',
    ],
  },
  {
    version: '0.8',
    date: '29 juillet 2026',
    items: [
      'Mode automatique mis en pause : bouton grisé et mention « En cours de construction »',
      '« Tout faire pour moi » devient « Démarrer », sans sous-titre',
      'Cases à cocher redessinées dans les fenêtres d\'avertissement et d\'export',
      'Badge Bêta masqué une fois l\'onglet Silence ouvert',
      'Espaces parasites corrigés sous les boutons repliables',
      'La fenêtre épinglée s\'ouvre centrée sur le navigateur',
      'Nettoyage des styles inutilisés',
    ],
  },
  {
    version: '0.7',
    date: '29 juillet 2026',
    items: [
      'Une couleur par onglet : jaune pour Auto, bleu pour Silence, violet pour Régulier, gris pour Outils',
      'Barre des onglets recentrée, badge Bêta hors flux',
      'Animations au changement d\'onglet et au dépliage des engrenages',
      'Avertissement bêta avec « Ne plus me le rappeler »',
      'Bouton « Placer les pubs » remonté en haut de la section Régulier',
      'Raccourcis simplifiés : 10s / 30s / 2min / 5min en Régulier, 10s / 30s / 1min / 2min en Auto',
      'Objectif Auto : fréquence et nombre inversés, fréquence par défaut',
      'Presets : choix des sections à embarquer (Auto, Silence, Régulier, Outils)',
    ],
  },
  {
    version: '0.6',
    date: '28 juillet 2026',
    items: [
      'Numérotation en Bêta 0.X, anciennes versions renommées',
      'Thème clair par défaut',
      'Onglet Silence signalé comme bêta, avec avertissement au premier clic',
      'Durée minimale du silence réglée au curseur, de 0 à 1000 ms',
      'Bouton « Placer dans les silences » remonté au-dessus des options',
      'Panneau Admin et mode maintenance entièrement retirés',
      '« Réduire » rejoint les actions manuelles, avec son engrenage',
    ],
  },
  {
    version: '0.5',
    date: '28 juillet 2026',
    items: [
      'Bouton Épingle : détache l\'extension dans une fenêtre qui reste ouverte quand tu cliques sur la page',
      'Le mode automatique s\'épingle tout seul jusqu\'à la fin du parcours',
      'Bouton « Arrêter » pour interrompre à tout moment un placement ou une suppression',
    ],
  },
  {
    version: '0.4',
    date: '28 juillet 2026',
    items: [
      'Bandeau rouge et blocage complet hors de YouTube Studio',
      '« Réduire » est devenu une option de l\'onglet Outils',
    ],
  },
  {
    version: '0.3',
    date: '28 juillet 2026',
    items: [
      'Presets : enregistre tes réglages et réapplique-les en un clic',
      'Codes de partage courts (16 caractères) pour échanger un preset',
      'Mode automatique en 3 étapes, entièrement réglable (engrenage)',
      'Objectif final au choix : nombre de pubs ou fréquence',
      'Thème clair / sombre au choix',
      'Interface allégée et réglages conservés à la fermeture',
    ],
  },
  {
    version: '0.2',
    date: '28 juillet 2026',
    items: [
      'Onglets Silence, Régulier et Réduire',
      'Placement des pubs dans les silences, lu depuis la forme d\'onde de l\'éditeur',
      'Placement des pubs à intervalle régulier',
      'Saisie manuelle du temps en minutes / secondes',
      'Panneau des mises à jour',
      'Refonte complète du design et fenêtres de confirmation intégrées',
    ],
  },
  {
    version: '0.1',
    date: '19 juillet 2026',
    items: [
      'Suppression des emplacements marqués comme invalides',
      'Optimisation de l\'espacement des emplacements',
      'Conversion des pubs automatiques en emplacements manuels',
      'Calcul de l\'écart moyen entre les pubs',
    ],
  },
];

/* ------------------------------------------------------------------ Statut */

const statusBox = document.getElementById('status');
const statusText = document.getElementById('status-text');
const DEFAULT_HINT = "Ouvre l'éditeur d'emplacements dans YouTube Studio.";

let lastStatus = { text: DEFAULT_HINT, type: 'hint' };

function paintStatus(text, type) {
  statusText.textContent = text;
  statusBox.className = 'status is-' + type;
}

function setStatus(text, type = 'ok') {
  lastStatus = { text, type };
  paintStatus(text, type);
}

/* Amène la barre de statut dans le champ de vision. Pendant le défilement, le
 * contenu passe sous le curseur immobile et déclenche des survols parasites
 * qui écrasaient le résultat : on met l'aide en sourdine le temps du trajet. */
let hintsMuted = false;

function revealStatus() {
  hintsMuted = true;
  statusBox.scrollIntoView({ behavior: 'smooth', block: 'end' });
  setTimeout(() => {
    hintsMuted = false;
  }, 900);
}

// Survoler un élément en affiche l'explication, sans perdre le dernier résultat.
document.querySelectorAll('[data-hint]').forEach((el) => {
  el.addEventListener('mouseenter', () => {
    if (lastStatus.type === 'busy' || hintsMuted) return;
    paintStatus(el.dataset.hint, 'hint');
  });
  el.addEventListener('mouseleave', () => {
    if (lastStatus.type === 'busy' || hintsMuted) return;
    paintStatus(lastStatus.text, lastStatus.type);
  });
});

/* ---------------------------------------------------------------- Fenêtres */

const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modal-title');
const modalMessage = document.getElementById('modal-message');
const modalInput = document.getElementById('modal-input');
const modalConfirm = document.getElementById('modal-confirm');
const modalCancel = document.getElementById('modal-cancel');
const modalChoices = document.getElementById('modal-choices');
const modalRemember = document.getElementById('modal-remember');
const modalRememberBox = document.getElementById('modal-remember-box');
let resolveModal = null;

function askConfirm({
  title,
  message,
  confirmLabel = 'Continuer',
  danger = false,
  prompt = null,
  alertOnly = false,
  choices = null,
  remember = false,
}) {
  modalTitle.textContent = title;
  modalMessage.textContent = message;
  modalMessage.hidden = !message;
  modalConfirm.textContent = confirmLabel;
  modalConfirm.classList.toggle('danger', danger);
  modalCancel.hidden = alertOnly; // simple avertissement : un seul bouton

  modalInput.hidden = !prompt;
  if (prompt) {
    modalInput.placeholder = prompt.placeholder || '';
    modalInput.value = prompt.value || '';
  }

  modalChoices.hidden = !choices;
  modalChoices.textContent = '';
  if (choices) {
    choices.forEach((choice) => {
      const row = document.createElement('label');
      row.className = 'choice' + (choice.checked ? ' checked' : '');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!choice.checked;
      box.dataset.key = choice.key;
      box.addEventListener('change', () => row.classList.toggle('checked', box.checked));
      const text = document.createElement('span');
      text.textContent = choice.label;
      row.append(box, text);
      modalChoices.appendChild(row);
    });
  }

  modalRemember.hidden = !remember;
  modalRememberBox.checked = false;

  modal.classList.add('open');
  if (prompt) {
    modalInput.focus();
    modalInput.select();
  } else {
    modalConfirm.focus();
  }

  return new Promise((resolve) => {
    resolveModal = resolve;
  });
}

// Renvoie false si annulé. Sinon true, la saisie, ou un objet quand la
// fenêtre combine plusieurs champs.
function closeModal(confirmed) {
  const prompted = !modalInput.hidden;
  const picking = !modalChoices.hidden;
  const remembering = !modalRemember.hidden;

  modal.classList.remove('open');
  if (!resolveModal) return;

  let answer = false;
  if (confirmed) {
    const sections = picking
      ? Array.from(modalChoices.querySelectorAll('input:checked')).map((b) => b.dataset.key)
      : null;

    if (picking) answer = { name: prompted ? modalInput.value.trim() : '', sections };
    else if (prompted) answer = modalInput.value.trim();
    else if (remembering) answer = { ok: true, remember: modalRememberBox.checked };
    else answer = true;
  }

  resolveModal(answer);
  resolveModal = null;
}

modalConfirm.addEventListener('click', () => closeModal(true));
modalCancel.addEventListener('click', () => closeModal(false));
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeModal(false);
});
modalInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') closeModal(true);
});

const sheets = {
  presets: document.getElementById('presets'),
  changelog: document.getElementById('changelog'),
  dev: document.getElementById('dev'),
};

function syncSheetHeight() {
  const open = Object.values(sheets).some((s) => s.classList.contains('open'));
  document.body.classList.toggle('sheet-open', open);
}

function openSheet(sheet) {
  sheet.classList.add('open');
  syncSheetHeight();
}

function closeSheet(sheet) {
  sheet.classList.remove('open');
  syncSheetHeight();
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (modal.classList.contains('open')) {
    closeModal(false);
    return;
  }
  Object.values(sheets).forEach((s) => s.classList.remove('open'));
  syncSheetHeight();
});

function setBusy(button, busy) {
  button.disabled = busy;
  const icon = button.querySelector('.action-icon, .hero-icon, .btn-icon');
  if (!icon) return;
  if (busy) {
    icon.dataset.icon = icon.innerHTML;
    icon.innerHTML = '<span class="spinner"></span>';
  } else if (icon.dataset.icon) {
    icon.innerHTML = icon.dataset.icon;
    delete icon.dataset.icon;
  }
}

/* ---------------------------------------------------------------- Épinglage
 * Un popup d'extension se ferme dès qu'on clique ailleurs — le navigateur ne
 * laisse aucun moyen de l'en empêcher. « Épingler » rouvre donc la même
 * interface dans une petite fenêtre détachée, qui, elle, reste ouverte.
 * -------------------------------------------------------------------------*/

const urlParams = new URLSearchParams(location.search);
const isPinned = urlParams.get('pinned') === '1';
// Ouvert dans un onglet dédié : seul contexte où un sélecteur de dossier peut
// s'ouvrir sans fermer l'interface.
const isUpdaterView = urlParams.get('updater') === '1';
const pinnedTabId = Number(urlParams.get('tab')) || null;
const PIN_KEY = 'pinnedWindowId';

if (isPinned) document.body.classList.add('is-pinned');

// Depuis une fenêtre détachée, « l'onglet courant » n'existe pas : on suit
// l'onglet d'origine, avec repli sur n'importe quel onglet YouTube Studio.
async function getStudioTab() {
  if (isPinned) {
    if (pinnedTabId) {
      try {
        const tab = await chrome.tabs.get(pinnedTabId);
        if (tab && tab.url && tab.url.includes('studio.youtube.com')) return tab;
      } catch (e) { /* onglet fermé : on cherche ailleurs */ }
    }
    const [fallback] = await chrome.tabs.query({ url: 'https://studio.youtube.com/*' });
    return fallback || null;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes('studio.youtube.com')) return null;
  return tab;
}

function videoIdOf(url) {
  const match = /\/video\/([^/?#]+)/.exec(url || '');
  return match ? match[1] : null;
}

const pinButton = document.getElementById('pin-btn');
const stopButton = document.getElementById('stop-run');

let operationRunning = false;

// Le mode auto verrouille l'épinglage jusqu'à la fin du parcours.
function pinLocked() {
  return operationRunning || pipelineRunning || settings.auto.state === 'reload';
}

function renderPin() {
  pinButton.classList.toggle('on', isPinned);
  pinButton.classList.toggle('locked', isPinned && pinLocked());
  pinButton.dataset.hint = isPinned
    ? pinLocked()
      ? "Épinglage verrouillé jusqu'à la fin du mode automatique."
      : 'Détacher : referme cette fenêtre et revient au popup normal.'
    : "Épingler : détache l'extension dans une petite fenêtre qui reste ouverte quand tu cliques sur la page.";
}

async function openPinnedWindow(extra = '') {
  const stored = await chrome.storage.local.get(PIN_KEY);
  if (stored[PIN_KEY]) {
    try {
      await chrome.windows.update(stored[PIN_KEY], { focused: true });
      return true;
    } catch (e) { /* fenêtre déjà refermée */ }
  }

  const width = 396;
  const height = 660;
  let left;
  let top;
  try {
    // centrée sur la fenêtre du navigateur, pas collée dans un coin
    const current = await chrome.windows.getCurrent();
    const winWidth = current.width || 1280;
    const winHeight = current.height || 800;
    left = Math.max(0, Math.round((current.left || 0) + (winWidth - width) / 2));
    top = Math.max(0, Math.round((current.top || 0) + (winHeight - height) / 2));
  } catch (e) { /* on laisse le navigateur choisir */ }

  const created = await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html?pinned=1' + extra),
    type: 'popup',
    width,
    height,
    left,
    top,
    focused: true,
  });

  await chrome.storage.local.set({ [PIN_KEY]: created.id });
  return false;
}

pinButton.addEventListener('click', async () => {
  if (isPinned) {
    if (pinLocked()) {
      setStatus("Impossible de détacher tant que le mode automatique n'est pas terminé.", 'warn');
      return;
    }
    await chrome.storage.local.remove(PIN_KEY);
    const current = await chrome.windows.getCurrent();
    chrome.windows.remove(current.id);
    return;
  }

  const tab = await getStudioTab();
  await openPinnedWindow(tab ? '&tab=' + tab.id : '');
  window.close();
});

// Arrêt : un drapeau posé dans la page, relu par les boucles à chaque tour.
function beginOperation() {
  operationRunning = true;
  stopButton.hidden = false;
  renderPin();
}

function endOperation() {
  operationRunning = false;
  stopButton.hidden = true;
  renderPin();
}

stopButton.addEventListener('click', async () => {
  const tab = await getStudioTab();
  if (!tab) return;

  const raise = () => {
    window.__ytAdToolStop = true;
  };

  // Le drapeau doit exister dans les deux mondes : les insertions tournent
  // dans celui de la page, les suppressions dans celui de l'extension.
  await Promise.all([
    chrome.scripting.executeScript({ target: { tabId: tab.id }, func: raise, world: 'MAIN' }),
    chrome.scripting.executeScript({ target: { tabId: tab.id }, func: raise, world: 'ISOLATED' }),
  ]).catch(() => {});

  pipelineAbort = true; // coupe aussi le parcours automatique entre deux étapes
  stopButton.hidden = true;
  setStatus('Arrêt demandé… la boucle en cours se termine.', 'warn');
});

async function runInPage(func, args = [], world = 'MAIN') {
  const tab = await getStudioTab();
  if (!tab) return { tab: null };
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func,
    args,
    world,
  });
  return { tab, result };
}

/* ------------------------------------------------------------- Préférences */

const DEFAULTS = {
  tab: 'auto',
  theme: 'light',
  intervals: {
    silenceGap: 120,
    insertInterval: 120,
    subtractive: 120,
    autoFill: 10,
    autoInterval: 120,
  },
  silenceMinMs: 500,
  silenceBetaAck: false,
  // Un booléen, pas un numéro de version : l'annonce de sortie de bêta ne
  // doit se jouer qu'une fois dans la vie de l'installation, jamais se
  // redéclencher à chaque future mise à jour (1.1, 1.2...).
  stableWelcomeSeen: false,
  dev: { cooldown: 20, confetti: 10 },
  stats: { xp: 0, savedSeconds: 0 },
  silenceLevel: 30,
  sub: { mode: 'interval', count: 8 },
  auto: {
    mode: 'interval',
    fillMode: 'interval',
    count: 8,
    convert: true,
    preRoll: false,
    endRoll: false,
    autoSave: true,
    state: 'idle',
    videoId: null,
  },
  presets: [],
  lastSeenVersion: null,
};

const settings = structuredClone(DEFAULTS);

function saveSettings() {
  chrome.storage?.local.set({ settings });
}

/* ------------------------------------------------------------------- Thème */

function effectiveTheme() {
  if (settings.theme === 'light' || settings.theme === 'dark') return settings.theme;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme() {
  if (settings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', settings.theme);
}

document.getElementById('theme-btn').addEventListener('click', () => {
  settings.theme = effectiveTheme() === 'dark' ? 'light' : 'dark';
  applyTheme();
  saveSettings();
});

/* ----------------------------------------------------------------- Onglets */

const tabButtons = Array.from(document.querySelectorAll('.tab'));

/* ---------------------------------------------------- Pastilles glissantes */

const SECTION_GRADIENTS = {
  auto: { gradient: 'linear-gradient(135deg, #ffc247, #ff8a3d)', glow: 'rgba(255, 176, 32, .38)' },
  silence: { gradient: 'linear-gradient(135deg, #5b97ff, #2f6ee0)', glow: 'rgba(76, 141, 255, .35)' },
  interval: { gradient: 'linear-gradient(135deg, #b07dff, #7b3fe4)', glow: 'rgba(165, 107, 255, .35)' },
  tools: { gradient: 'linear-gradient(135deg, #9d9daa, #63636f)', glow: 'rgba(99, 99, 111, .3)' },
};

const tabsBar = document.querySelector('.tabs');
const tabThumb = document.createElement('div');
tabThumb.className = 'tab-thumb';
tabsBar.appendChild(tabThumb);

/* Cale la pastille exactement sur le bouton visé. offsetLeft part du bord
 * extérieur du conteneur, la pastille du bord intérieur : sans retrancher la
 * bordure, le texte se retrouve décentré dans la couleur. */
function placeThumb(thumb, target, container) {
  thumb.style.width = `${target.offsetWidth}px`;
  thumb.style.height = `${target.offsetHeight}px`;
  thumb.style.transform =
    `translate(${target.offsetLeft - container.clientLeft}px, ${target.offsetTop - container.clientTop}px)`;
}

function moveTabThumb() {
  const active = tabButtons.find((b) => b.classList.contains('active'));
  if (!active) return;

  const theme = SECTION_GRADIENTS[active.dataset.tab] || SECTION_GRADIENTS.silence;
  placeThumb(tabThumb, active, tabsBar);
  tabThumb.style.background = theme.gradient;
  tabThumb.style.boxShadow = `0 3px 10px ${theme.glow}`;
}

// Une pastille par groupe de choix (Souple/Normal/Strict, Régulier/Silence...).
function mountSegThumb(seg) {
  const thumb = document.createElement('div');
  thumb.className = 'seg-thumb';
  seg.appendChild(thumb);
  seg.__thumb = thumb;
}

function moveSegThumb(seg) {
  const thumb = seg.__thumb;
  const active = seg.querySelector('button.selected');
  if (!thumb) return;

  if (!active) {
    thumb.style.width = '0';
    return;
  }

  placeThumb(thumb, active, seg);
}

const segGroups = Array.from(document.querySelectorAll('.seg'));
segGroups.forEach(mountSegThumb);

// Les pastilles se repositionnent après chaque rendu ou changement d'onglet.
function refreshThumbs() {
  moveTabThumb();
  segGroups.forEach(moveSegThumb);
}

function showTab(name) {
  // « Réduire » a été fusionné dans « Outils » : on redirige l'ancien onglet.
  const wanted = name === 'subtractive' ? 'tools' : name;
  const known = tabButtons.some((b) => b.dataset.tab === wanted);
  const target = known ? wanted : 'auto';
  tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === target));
  document.querySelectorAll('.panel').forEach((p) => {
    p.classList.toggle('active', p.id === 'panel-' + target);
  });
  settings.tab = target;
  requestAnimationFrame(refreshThumbs);
}

tabButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    showTab(button.dataset.tab);
    saveSettings();

    if (button.dataset.tab === 'silence') await warnSilenceBeta();
  });
});

/* ------------------------------------------------- Contrôles d'intervalle */

// Les deux boutons principaux résument les réglages : ils suivent tout changement.
function refreshSummaries() {
  renderAuto();
  renderSubTarget();
}

function setupIntervalControl(root) {
  const key = root.dataset.key;
  const slider = root.querySelector('.interval-slider');
  const badge = root.querySelector('.value-badge');
  const minInput = root.querySelector('.min-input');
  const secInput = root.querySelector('.sec-input');
  const presets = Array.from(root.querySelectorAll('.preset-btn'));
  const lo = Number(slider.min);
  const hi = Number(slider.max);
  let value = Number(slider.value);

  function render(withFields = true) {
    badge.textContent = formatInterval(value);
    slider.value = String(value);
    slider.style.setProperty('--fill', `${((value - lo) / (hi - lo)) * 100}%`);
    if (withFields) {
      minInput.value = String(Math.floor(value / 60));
      secInput.value = String(value % 60);
    }
    presets.forEach((b) => b.classList.toggle('selected', Number(b.dataset.seconds) === value));
  }

  function set(next, withFields = true) {
    const wanted = Math.round(Number(next) || 0);
    value = Math.min(hi, Math.max(lo, wanted));
    settings.intervals[key] = value;
    render(withFields);
    return value === wanted;
  }

  slider.addEventListener('input', () => {
    set(slider.value);
    saveSettings();
  });

  presets.forEach((b) => {
    b.addEventListener('click', () => {
      set(b.dataset.seconds);
      syncControl(key, value);
      saveSettings();
      refreshSummaries();
    });
  });

  // Saisie manuelle : on ne réécrit pas les champs pendant la frappe.
  [minInput, secInput].forEach((input) => {
    input.addEventListener('input', () => {
      set(Number(minInput.value) * 60 + Number(secInput.value), false);
      syncControl(key, value);
      saveSettings();
      refreshSummaries();
    });
    input.addEventListener('blur', () => {
      const exact = set(Number(minInput.value) * 60 + Number(secInput.value));
      syncControl(key, value);
      saveSettings();
      if (!exact) {
        setStatus(
          `Valeur ajustée à ${formatInterval(value)} (min ${formatInterval(lo)}, max ${formatInterval(hi)}).`,
          'warn'
        );
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
    });
  });

  slider.addEventListener('input', () => syncControl(key, value));

  render();
  return {
    get value() {
      return value;
    },
    set,
  };
}

/* Un même réglage peut être affiché à deux endroits (l'écart minimum existe
 * dans l'onglet Silence et dans le mode Auto) : on tient donc une liste
 * d'instances par clé, et toute modification est répercutée sur les autres. */
const controlGroups = {};

document.querySelectorAll('.interval-control').forEach((root) => {
  const key = root.dataset.key;
  if (!controlGroups[key]) controlGroups[key] = [];
  controlGroups[key].push(setupIntervalControl(root));
});

function syncControl(key, value, except) {
  (controlGroups[key] || []).forEach((instance) => {
    if (instance !== except && instance.value !== value) instance.set(value);
  });
}

const controls = {};
Object.entries(controlGroups).forEach(([key, group]) => {
  controls[key] = {
    get value() {
      return group[0].value;
    },
    set(next, withFields = true) {
      let exact = true;
      group.forEach((instance) => {
        exact = instance.set(next, withFields) && exact;
      });
      return exact;
    },
  };
});

/* -------------------------------------------------------- Options Silence */

const silenceSliders = Array.from(document.querySelectorAll('.silence-dur'));
const silenceBadges = Array.from(document.querySelectorAll('.silence-dur-badge'));
const sensitivityButtons = Array.from(document.querySelectorAll('.sensitivity-seg button'));

function renderSensitivity() {
  sensitivityButtons.forEach((b) => {
    b.classList.toggle('selected', Number(b.dataset.level) === settings.silenceLevel);
  });
  requestAnimationFrame(refreshThumbs);
}

sensitivityButtons.forEach((b) => {
  b.addEventListener('click', () => {
    settings.silenceLevel = Number(b.dataset.level);
    renderSensitivity();
    saveSettings();
  });
});

function renderSilenceDuration() {
  const value = settings.silenceMinMs;
  silenceSliders.forEach((slider) => {
    slider.value = String(value);
    slider.style.setProperty('--fill', `${(value / 1000) * 100}%`);
  });
  silenceBadges.forEach((badge) => {
    badge.textContent = `${value} ms`;
  });
}

silenceSliders.forEach((slider) => {
  slider.addEventListener('input', () => {
    settings.silenceMinMs = Math.min(1000, Math.max(0, Number(slider.value) || 0));
    renderSilenceDuration();
    saveSettings();
  });
});


/* -------------------------------------------------------- Objectif Réduire */

const subModeButtons = Array.from(document.querySelectorAll('#sub-target-mode button'));
const subCountRow = document.getElementById('sub-count-row');
const subIntervalRow = document.getElementById('sub-interval-row');
const subCount = document.getElementById('sub-count');

const reduceButton = document.getElementById('apply-interval');

function renderSubTarget() {
  const byCount = settings.sub.mode === 'count';
  subModeButtons.forEach((b) => b.classList.toggle('selected', (b.dataset.mode === 'count') === byCount));
  subCountRow.hidden = !byCount;
  subIntervalRow.hidden = byCount;
  subCount.value = String(settings.sub.count);

  // L'objectif courant est rappelé dans l'aide au survol.
  const target = byCount
    ? `ne garder que ${plural(settings.sub.count, 'pub')}`
    : `garder une pub toutes les ${formatInterval(controls.subtractive.value)}`;
  reduceButton.dataset.hint = `Supprime les pubs en trop pour ${target}, en sacrifiant d'abord les intrusives.`;
  requestAnimationFrame(refreshThumbs);
}

const reduceGear = document.getElementById('reduce-gear');
const reduceOptions = document.getElementById('reduce-options');

reduceGear.addEventListener('click', () => {
  const opening = !reduceOptions.classList.contains('open');
  reduceOptions.classList.toggle('open', opening);
  reduceGear.classList.toggle('open', opening);
});

subModeButtons.forEach((b) => {
  b.addEventListener('click', () => {
    settings.sub.mode = b.dataset.mode;
    renderSubTarget();
    saveSettings();
  });
});

subCount.addEventListener('input', () => {
  const parsed = Number(subCount.value);
  settings.sub.count = Math.min(60, Math.max(1, Number.isFinite(parsed) && parsed ? Math.round(parsed) : 8));
  saveSettings();
});

/* ------------------------------------------------------- Mode automatique */

const autoRun = document.getElementById('auto-run');
const autoTitle = document.getElementById('auto-title');
const AUTO_ENABLED = true;
const autoGear = document.getElementById('auto-gear');
const autoOptions = document.getElementById('auto-options');
const autoReload = document.getElementById('auto-reload');
const autoCancel = document.getElementById('auto-cancel');
const autoModeButtons = Array.from(document.querySelectorAll('#auto-target-mode button'));
const autoFillModeButtons = Array.from(document.querySelectorAll('#auto-fill-mode button'));
const autoCountRow = document.getElementById('auto-count-row');
const autoIntervalRow = document.getElementById('auto-interval-row');
const autoCount = document.getElementById('auto-count');
const autoConvert = document.getElementById('auto-convert');
const autoPreRoll = document.getElementById('auto-preroll');
const autoEndRoll = document.getElementById('auto-endroll');
const autoSave = document.getElementById('auto-save');
const steps = [1, 2, 3, 4].map((n) => document.getElementById('step-' + n));
const autoWip = document.getElementById('auto-wip');
const autoProgress = document.getElementById('auto-progress');
const autoCountdown = document.getElementById('auto-countdown');
const autoMessage = document.getElementById('auto-message');
const autoEta = document.getElementById('auto-eta');

autoWip.hidden = AUTO_ENABLED;
autoRun.classList.toggle('disabled', !AUTO_ENABLED);
steps.forEach((step) => step.classList.toggle('muted', !AUTO_ENABLED));

const autoFillBlock = document.getElementById('auto-fill-block');
const autoSilenceBlock = document.getElementById('auto-silence-block');

// L'avertissement bêta vaut pour l'onglet Silence comme pour le mode Silence.
async function warnSilenceBeta() {
  if (settings.silenceBetaAck) return;

  const answer = await askConfirm({
    title: 'Fonctionnalité en bêta',
    message:
      'Le placement dans les silences est encore en bêta : la détection peut se tromper et ' +
      "des pubs peuvent être mal placées. Vérifie le résultat avant d'enregistrer.",
    confirmLabel: "J'ai compris",
    alertOnly: true,
    remember: true,
  });

  if (answer && answer.remember) {
    settings.silenceBetaAck = true;
    saveSettings();
  }
}

autoFillModeButtons.forEach((b) => {
  b.addEventListener('click', async () => {
    settings.auto.fillMode = b.dataset.mode;
    renderAuto();
    saveSettings();
    if (b.dataset.mode === 'silence') await warnSilenceBeta();
  });
});

function plural(count, word) {
  return `${count} ${word}${count > 1 ? 's' : ''}`;
}

function autoTargetLabel() {
  return settings.auto.mode === 'count'
    ? plural(settings.auto.count, 'pub')
    : formatInterval(controls.autoInterval.value);
}

function renderAuto() {
  const pending = settings.auto.state === 'reload';

  autoTitle.textContent = pending ? 'Terminer le nettoyage' : 'Démarrer';
  autoRun.dataset.hint = AUTO_ENABLED
    ? `Remplit toutes les ${formatInterval(controls.autoFill.value)}, objectif ${autoTargetLabel()}.`
    : "Le mode automatique est encore en construction : il sera réactivé quand il sera fiable.";

  autoReload.hidden = !pending;
  autoCancel.hidden = !pending;

  steps[0].classList.toggle('done', pending);
  steps[0].classList.toggle('active', !pending);
  steps[1].classList.toggle('active', pending);
  steps[2].classList.remove('active');

  const byCount = settings.auto.mode === 'count';
  autoModeButtons.forEach((b) => b.classList.toggle('selected', (b.dataset.mode === 'count') === byCount));
  autoCountRow.hidden = !byCount;
  autoIntervalRow.hidden = byCount;
  autoCount.value = String(settings.auto.count);
  autoConvert.checked = settings.auto.convert;
  autoPreRoll.checked = settings.auto.preRoll;
  autoEndRoll.checked = settings.auto.endRoll;
  autoSave.checked = settings.auto.autoSave;

  const bySilence = settings.auto.fillMode === 'silence';
  autoFillModeButtons.forEach((b) =>
    b.classList.toggle('selected', (b.dataset.mode === 'silence') === bySilence)
  );
  autoFillBlock.hidden = bySilence;
  autoSilenceBlock.hidden = !bySilence;
  requestAnimationFrame(refreshThumbs);
}

autoGear.addEventListener('click', () => {
  const opening = !autoOptions.classList.contains('open');
  autoOptions.classList.toggle('open', opening);
  autoGear.classList.toggle('open', opening);
});

autoModeButtons.forEach((b) => {
  b.addEventListener('click', () => {
    settings.auto.mode = b.dataset.mode;
    renderAuto();
    saveSettings();
  });
});

autoCount.addEventListener('input', () => {
  const parsed = Number(autoCount.value);
  settings.auto.count = Math.min(60, Math.max(1, Number.isFinite(parsed) && parsed ? Math.round(parsed) : 8));
  renderAuto();
  saveSettings();
});

autoSave.addEventListener('change', () => {
  settings.auto.autoSave = autoSave.checked;
  saveSettings();
});

autoConvert.addEventListener('change', () => {
  settings.auto.convert = autoConvert.checked;
  saveSettings();
});

autoPreRoll.addEventListener('change', () => {
  settings.auto.preRoll = autoPreRoll.checked;
  saveSettings();
});

autoEndRoll.addEventListener('change', () => {
  settings.auto.endRoll = autoEndRoll.checked;
  saveSettings();
});

autoCancel.addEventListener('click', () => {
  settings.auto.state = 'idle';
  settings.auto.videoId = null;
  saveSettings();
  renderAuto();
  setStatus('Automatisation annulée.', 'warn');
});

autoReload.addEventListener('click', async () => {
  const confirmed = await askConfirm({
    title: 'Recharger la page ?',
    message:
      'Vérifie d\'abord que tes pubs sont enregistrées (bouton « Continuer » puis « Enregistrer » dans Studio), sinon elles seront perdues.',
    confirmLabel: 'Recharger',
    danger: true,
  });
  if (!confirmed) return;

  const tab = await getStudioTab();
  if (!tab) {
    setStatus("Ouvre d'abord YouTube Studio.", 'warn');
    return;
  }
  chrome.tabs.reload(tab.id);
  setStatus('Page rechargée. Rouvre les emplacements d\'annonce, puis clique sur « Terminer le nettoyage ».', 'busy');
});

/* --------------------------------------------------------------- Messages */

const INSERT_ERRORS = {
  'no-editor': "L'éditeur d'emplacements n'est pas ouvert dans l'onglet actif.",
  'no-waveform': "La forme d'onde n'est pas encore chargée. Attends l'affichage de la timeline, puis réessaie.",
  'no-duration': 'Impossible de déterminer la durée de la vidéo.',
  'no-target': 'Aucun emplacement à ajouter.',
};

const INSERT_FAILURES = {
  'no-editor': "le champ d'ajout n'a pas été trouvé",
  'editor-stalled': "l'éditeur a refusé plusieurs horodatages d'affilée",
};

const SAVE_HINT = 'Clique sur « Continuer » dans YouTube Studio pour enregistrer.';

function describeInsertion(result, mode) {
  const parts = [(result.stopped ? 'Arrêté — ' : '') + `${result.inserted} pub(s) ajoutée(s)`];
  if (mode === 'silence') parts.push(`${result.silences} silence(s) détecté(s)`);
  if (result.skipped) parts.push(`${result.skipped} refusée(s)`);
  if (result.truncated) parts.push('liste tronquée à 500');
  if (result.reason) parts.push(`arrêt : ${INSERT_FAILURES[result.reason] || result.reason}`);
  return parts.join(' — ');
}

/* ------------------------------------------------------------- Insertions */

async function runInsertion(button, mode, params, busyMessage, { celebrate = true } = {}) {
  setBusy(button, true);
  beginOperation();
  setStatus(busyMessage, 'busy');
  const startedAt = Date.now();

  try {
    const { tab, result } = await runInPage(insertAdBreaks, [mode, params]);

    if (!tab) {
      setStatus("Ouvre d'abord YouTube Studio.", 'warn');
      return null;
    }
    if (!result) {
      setStatus('Aucune réponse de la page. Recharge YouTube Studio et réessaie.', 'err');
      return null;
    }
    if (result.error && result.error !== 'no-target') {
      setStatus(INSERT_ERRORS[result.error] || 'Erreur : ' + result.error, 'err');
      return null;
    }
    if (result.inserted === 0) {
      if (result.reason) {
        setStatus(`Aucune pub ajoutée : ${INSERT_FAILURES[result.reason] || result.reason}.`, 'err');
      } else {
        const detail = mode === 'silence' ? ` (${result.silences || 0} silence(s) détecté(s))` : '';
        setStatus(INSERT_ERRORS['no-target'] + detail, 'warn');
      }
      return null;
    }

    setStatus(
      `${describeInsertion(result, mode)}. ${SAVE_HINT}`,
      result.reason || result.stopped ? 'warn' : 'ok'
    );

    if (celebrate) {
      finishAction({
        detail: `${result.inserted} pub(s) placée(s). ${SAVE_HINT}`,
        ads: result.inserted,
        startedAt,
      });
    }
    return result;
  } catch (err) {
    setStatus('Erreur : ' + err.message, 'err');
    return null;
  } finally {
    setBusy(button, false);
    endOperation();
  }
}

document.getElementById('run-silence').addEventListener('click', async (e) => {
  const button = e.currentTarget;
  const gap = controls.silenceGap.value;

  const confirmed = await askConfirm({
    title: 'Placer dans les silences ?',
    message: `Une pub par silence d'au moins ${settings.silenceMinMs} ms, avec au minimum ${formatInterval(gap)} entre deux pubs.`,
    confirmLabel: 'Placer',
  });
  if (!confirmed) return;

  await runInsertion(
    button,
    'silence',
    {
      minSilenceSeconds: settings.silenceMinMs / 1000,
      levelPercent: settings.silenceLevel,
      minGapSeconds: gap,
    },
    'Analyse et insertion en cours...'
  );
});

document.getElementById('run-interval').addEventListener('click', async (e) => {
  const button = e.currentTarget;
  const interval = controls.insertInterval.value;

  const confirmed = await askConfirm({
    title: 'Placer les pubs ?',
    message: `Une pub toutes les ${formatInterval(interval)} sur toute la vidéo.`,
    confirmLabel: 'Placer',
  });
  if (!confirmed) return;

  await runInsertion(button, 'interval', { intervalSeconds: interval }, 'Insertion en cours...');
});

/* -------------------------------------------------------------- Réduction */

async function reduce(button, target, busyMessage, { celebrate = true } = {}) {
  setBusy(button, true);
  beginOperation();
  setStatus(busyMessage, 'busy');
  const startedAt = Date.now();

  try {
    const { tab, result } = await runInPage(reduceAdBreaks, [target], 'ISOLATED');

    if (!tab) {
      setStatus("Ouvre d'abord YouTube Studio.", 'warn');
      return null;
    }
    if (!result || result.total === 0) {
      setStatus("Aucun emplacement trouvé (l'éditeur est-il bien ouvert ?).", 'warn');
      return null;
    }

    setStatus(
      (result.stopped ? 'Arrêté — ' : '') +
        `${result.kept} gardée(s), ${result.removed} supprimée(s) sur ${result.total}. ${SAVE_HINT}`,
      result.stopped ? 'warn' : 'ok'
    );

    if (celebrate && result.removed) {
      finishAction({
        detail: `${result.kept} pub(s) gardée(s), ${result.removed} supprimée(s). ${SAVE_HINT}`,
        ads: result.removed,
        startedAt,
      });
    }
    return result;
  } catch (err) {
    setStatus('Erreur : ' + err.message, 'err');
    return null;
  } finally {
    setBusy(button, false);
    endOperation();
  }
}

document.getElementById('apply-interval').addEventListener('click', async (e) => {
  const button = e.currentTarget;
  const byCount = settings.sub.mode === 'count';
  const target = byCount
    ? { mode: 'count', count: settings.sub.count }
    : { mode: 'interval', interval: controls.subtractive.value };

  const confirmed = await askConfirm({
    title: 'Réduire les pubs ?',
    message: byCount
      ? `Seules ${plural(settings.sub.count, 'pub')} seront gardées, réparties sur la vidéo.`
      : `Une seule pub sera gardée toutes les ${formatInterval(controls.subtractive.value)}.`,
    confirmLabel: 'Réduire',
  });
  if (!confirmed) return;

  await reduce(button, target, 'Réduction en cours...');
});

/* ---------------------------------------------------- Suppressions simples */

async function runRemoval(button, func, emptyMessage, successMessage, { celebrate = true } = {}) {
  setBusy(button, true);
  beginOperation();
  setStatus('Suppression en cours...', 'busy');
  const startedAt = Date.now();

  try {
    const { tab, result } = await runInPage(func, [], 'ISOLATED');

    if (!tab) {
      setStatus("Ouvre d'abord YouTube Studio.", 'warn');
      return 0;
    }
    if (!result) {
      setStatus(emptyMessage, 'warn');
      return 0;
    }

    setStatus(successMessage(result), 'ok');

    if (celebrate && result > 0) {
      finishAction({ detail: successMessage(result), ads: result, startedAt });
    }
    return result;
  } catch (err) {
    setStatus('Erreur : ' + err.message, 'err');
    return 0;
  } finally {
    setBusy(button, false);
    endOperation();
  }
}

function handleRemoveInvalid(button) {
  return runRemoval(
    button,
    removeInvalidAdBreaks,
    "Aucun emplacement invalide trouvé (l'éditeur est-il bien ouvert ?).",
    (n) => `${n} pub(s) invalide(s) supprimée(s). ${SAVE_HINT}`
  );
}

document.getElementById('run').addEventListener('click', (e) => handleRemoveInvalid(e.currentTarget));

document.getElementById('reset').addEventListener('click', async (e) => {
  const button = e.currentTarget;
  const confirmed = await askConfirm({
    title: 'Tout supprimer ?',
    message: 'Toutes les pubs seront supprimées, valides comme invalides.',
    confirmLabel: 'Tout supprimer',
    danger: true,
  });
  if (!confirmed) return;

  await runRemoval(
    button,
    removeAllAdBreaks,
    "Aucun emplacement trouvé (l'éditeur est-il bien ouvert ?).",
    (n) => `${n} pub(s) supprimée(s) au total. ${SAVE_HINT}`
  );
});

/* ----------------------------------------------------- Conversion des auto */

async function convertAutoBreaks(button, quiet = false) {
  if (!quiet) {
    setBusy(button, true);
    setStatus('Conversion en cours...', 'busy');
  }

  try {
    const { tab, result } = await runInPage(convertAutoAdBreaksToManual);

    if (!tab) {
      if (!quiet) setStatus("Ouvre d'abord YouTube Studio.", 'warn');
      return null;
    }
    if (quiet) return result;

    if (!result || result.error === 'panel-not-found') {
      setStatus("Éditeur d'emplacements introuvable (est-il bien ouvert ?).", 'err');
    } else if (result.converted === 0) {
      setStatus('Aucune pub automatique à convertir.', 'warn');
    } else if (!result.confirmed) {
      setStatus(
        `${result.converted} pub(s) trouvée(s), mais la confirmation n'a pas pu être validée. Clique sur « OK » toi-même.`,
        'warn'
      );
    } else {
      setStatus(`${result.converted} pub(s) automatique(s) convertie(s). ${SAVE_HINT}`, 'ok');
    }
    return result;
  } catch (err) {
    if (!quiet) setStatus('Erreur : ' + err.message, 'err');
    return null;
  } finally {
    if (!quiet) setBusy(button, false);
  }
}

document.getElementById('convert-auto').addEventListener('click', (e) => convertAutoBreaks(e.currentTarget));

/* ------------------------------------------------------ Pipeline du mode auto */

autoRun.addEventListener('click', async () => {
  if (!AUTO_ENABLED) {
    setStatus(
      "Le mode automatique est en cours de construction : utilise les onglets Régulier et Outils en attendant.",
      'warn'
    );
    return;
  }

  if (pipelineRunning) return;
  await startAutoRun();
});

/* ---------------------------------------------------------------------------
 * Parcours automatique complet. Il tourne dans la fenêtre épinglée : c'est
 * elle qui survit au rechargement de la page, le popup normal serait détruit.
 * -------------------------------------------------------------------------*/

const RELOAD_WAIT_SECONDS = 5;

/* Coûts observés sur des parcours réels, en secondes. Ils servent à calculer
 * une estimation unique au démarrage : le décompte affiché couvre tout le
 * parcours, il n'est pas recalculé à chaque étape. */
const FIXED_COST = { save: 6, reload: 5, reopen: 6, finalSave: 6, spare: 5 };
const UNIT_COST = { insert: 0.07, del: 0.07 };

let pipelineRunning = false;
let pipelineAbort = false;
let etaTimer = null;
let countdownTimer = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class StepError extends Error {}

function clearTimers() {
  clearInterval(etaTimer);
  clearInterval(countdownTimer);
  etaTimer = null;
  countdownTimer = null;
  autoCountdown.hidden = true;
  autoEta.hidden = true;
}

function hideEta() {
  clearInterval(etaTimer);
  etaTimer = null;
  autoEta.hidden = true;
}

// Décompte simple, pour les étapes de durée connue.
function showEta(seconds) {
  if (!seconds || seconds <= 0) {
    hideEta();
    return;
  }

  const endsAt = Date.now() + seconds * 1000;
  autoEta.hidden = false;

  const tick = () => {
    const left = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
    autoEta.textContent = left ? `≈ ${formatInterval(left)} restantes` : 'Encore un instant…';
  };

  tick();
  clearInterval(etaTimer);
  etaTimer = setInterval(tick, 1000);
}

/* Estimation du parcours entier, calculée une seule fois au démarrage.
 * Le décompte affiché ensuite ne bouge plus d'une étape à l'autre : c'est le
 * temps restant avant la fin, pas celui de l'étape en cours. */
function estimateRun({ inserts, deletes, cooldown }) {
  return Math.round(
    cooldown +
      inserts * UNIT_COST.insert +
      deletes * UNIT_COST.del +
      FIXED_COST.save +
      FIXED_COST.reload +
      FIXED_COST.reopen +
      FIXED_COST.finalSave +
      FIXED_COST.spare
  );
}

function setPhase(step, message) {
  steps.forEach((el, index) => {
    el.classList.toggle('done', index + 1 < step);
    el.classList.toggle('active', index + 1 === step);
  });

  autoProgress.hidden = false;
  autoMessage.textContent = '';
  const spinner = document.createElement('span');
  spinner.className = 'spinner';
  autoMessage.append(spinner, message);
}

// Compte à rebours plein écran entre le remplissage et l'enregistrement.
function runCountdown(seconds) {
  return new Promise((resolve) => {
    const endsAt = Date.now() + seconds * 1000;
    autoCountdown.hidden = false;

    const tick = () => {
      const left = Math.ceil((endsAt - Date.now()) / 1000);
      if (left <= 0 || pipelineAbort) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        autoCountdown.hidden = true;
        resolve();
        return;
      }
      autoCountdown.textContent = String(left);
    };

    tick();
    countdownTimer = setInterval(tick, 250);
  });
}

/* ------------------------------------------------------------ Fête de fin */

const confettiLayer = document.getElementById('confetti');
const doneModal = document.getElementById('done-modal');
const doneTitle = document.getElementById('done-title');
const doneDetail = document.getElementById('done-detail');

const CONFETTI_COLORS = ['#ffc247', '#ff8a3d', '#2fbf6b', '#4c8dff', '#a56bff', '#ff2d55'];

function launchConfetti(seconds) {
  if (seconds <= 0) return;

  confettiLayer.textContent = '';
  confettiLayer.hidden = false;

  for (let i = 0; i < 70; i++) {
    const piece = document.createElement('i');
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    // départs échelonnés pour que la chute dure toute la fête
    piece.style.animationDelay = `${(Math.random() * Math.max(1, seconds - 2)).toFixed(2)}s`;
    piece.style.animationDuration = `${(1.8 + Math.random() * 1.6).toFixed(2)}s`;
    if (i % 3 === 0) piece.style.borderRadius = '50%';
    if (i % 4 === 0) piece.style.width = '5px';
    confettiLayer.appendChild(piece);
  }

  // fondu de sortie avant retrait, sinon les pastilles disparaissent d'un coup
  setTimeout(() => confettiLayer.classList.add('fading'), Math.max(200, seconds * 1000 - 900));
  setTimeout(() => {
    confettiLayer.hidden = true;
    confettiLayer.classList.remove('fading');
    confettiLayer.textContent = '';
  }, seconds * 1000);
}

function closeDoneModal() {
  doneModal.classList.remove('open');
}

document.getElementById('done-ok').addEventListener('click', closeDoneModal);
doneModal.addEventListener('click', (e) => {
  if (e.target === doneModal) closeDoneModal();
});

/* ------------------------------------------------------ Profil et gain d'XP */

// Coût manuel d'une pub : ouvrir le champ, saisir l'horodatage, vérifier.
// Le temps réellement passé par l'extension est ensuite déduit, sinon le
// « temps gagné » devient vite fantaisiste.
const SECONDS_PER_AD = 2;
const XP_PER_LEVEL = 150;

const xpToast = document.getElementById('xp-toast');
const xpToastGain = document.getElementById('xp-toast-gain');
const xpToastTime = document.getElementById('xp-toast-time');
let xpToastTimers = [];

function levelOf(xp) {
  return 1 + Math.floor(xp / XP_PER_LEVEL);
}

function renderProfile() {
  const { xp, savedSeconds } = settings.stats;
  const level = levelOf(xp);
  const intoLevel = xp % XP_PER_LEVEL;

  document.getElementById('level-badge').textContent = String(level);
  document.getElementById('level-title').textContent = `Niveau ${level}`;
  document.getElementById('level-detail').textContent =
    `${xp} XP — ${XP_PER_LEVEL - intoLevel} avant le niveau ${level + 1}`;
  document.getElementById('saved-total').textContent = formatInterval(Math.round(savedSeconds));
  document.getElementById('xp-bar-fill').style.width = `${(intoLevel / XP_PER_LEVEL) * 100}%`;
}

function showXpToast(gain, seconds) {
  xpToastTimers.forEach(clearTimeout);
  xpToastTimers = [];

  xpToastGain.textContent = `+${gain} XP`;
  xpToastTime.textContent = `${formatInterval(Math.round(seconds))} gagnées`;
  xpToast.hidden = false;
  xpToast.classList.remove('fading');

  xpToastTimers.push(setTimeout(() => xpToast.classList.add('fading'), 4200));
  xpToastTimers.push(
    setTimeout(() => {
      xpToast.hidden = true;
      xpToast.classList.remove('fading');
    }, 4700)
  );
}

// Récompense une action réussie : XP, temps gagné, et le petit bandeau.
function awardXp(ads, elapsedSeconds = 0) {
  const gain = Math.max(1, Math.round(ads));
  // gagné = ce que ça t'aurait coûté à la main, moins ce que ça vient de prendre
  const seconds = Math.max(0, Math.round(gain * SECONDS_PER_AD - elapsedSeconds));

  const before = levelOf(settings.stats.xp);
  settings.stats.xp += gain;
  settings.stats.savedSeconds += seconds;
  saveSettings();

  renderProfile();
  showXpToast(gain, seconds);

  return levelOf(settings.stats.xp) > before;
}

/* Fin d'une action : coche animée, confettis et gain d'XP. Utilisé aussi bien
 * par le mode automatique que par les outils manuels. */
function finishAction({ title, detail, ads, startedAt }) {
  const elapsed = startedAt ? (Date.now() - startedAt) / 1000 : 0;
  const levelUp = awardXp(ads, elapsed);

  celebrate(elapsed, detail, {
    title: title || (elapsed ? `Terminé en ${formatInterval(Math.max(1, Math.round(elapsed)))} !` : 'Terminé !'),
    levelUp,
  });
}

function celebrate(elapsedSeconds, detail, options = {}) {
  const duration = settings.dev.confetti;

  launchConfetti(duration);

  doneTitle.textContent =
    options.title || `Terminé en ${formatInterval(Math.max(1, Math.round(elapsedSeconds)))} !`;
  doneDetail.textContent = options.levelUp
    ? `${detail} Niveau ${levelOf(settings.stats.xp)} atteint !`
    : detail;
  doneModal.classList.add('open');

  // Les étapes restent vertes le temps de la fête, puis reviennent au neutre.
  setTimeout(() => {
    steps.forEach((el) => el.classList.remove('done', 'active'));
  }, Math.max(1, duration) * 1000);
}

/* Annonce de sortie de bêta : jouée une seule fois dans la vie de
 * l'installation, jamais reliée à un numéro de version précis pour ne pas
 * se redéclencher à chaque future mise à jour. Rejouable depuis le menu
 * développeur, qui affiche alors la version réellement installée. */
function announceRelease() {
  launchConfetti(Math.max(6, settings.dev.confetti));

  doneTitle.textContent = `La version ${installedVersion()} est là !`;
  doneDetail.textContent =
    "L'extension est sortie de bêta. Les mises à jour s'installent désormais depuis l'extension " +
    'elle-même, et le mode auto sait placer une pub en pré-roll et en end-roll.';
  doneModal.classList.add('open');

  settings.stableWelcomeSeen = true;
  saveSettings();
}

async function probeStudio(tab) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: studioAction,
      args: ['probe'],
      world: 'MAIN',
    });
    return result;
  } catch (e) {
    return null; // la page navigue : on retentera au tour suivant
  }
}

async function waitUntil(tab, test, timeoutMs, code) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pipelineAbort) throw new StepError('cancelled');
    const snapshot = await probeStudio(tab);
    if (snapshot && test(snapshot)) return snapshot;
    await sleep(700);
  }
  throw new StepError(code);
}

async function clickStudio(tab, action) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: studioAction,
    args: [action],
    world: 'MAIN',
  });
  return result && result.ok;
}

// « Continuer » puis « Enregistrer », en attendant que Studio ait bien fini.
async function saveStudioChanges(tab, tolerant = false) {
  if (!(await clickStudio(tab, 'continue')) && !tolerant) throw new StepError('continue-not-found');

  try {
    await waitUntil(tab, (s) => !s.editorOpen, 12000, 'editor-still-open');
  } catch (err) {
    if (err.message === 'cancelled' || !tolerant) throw err;
  }
  await sleep(800);

  if (!(await clickStudio(tab, 'save')) && !tolerant) throw new StepError('save-not-found');

  try {
    await waitUntil(tab, (s) => !s.hasSave, 30000, 'save-timeout');
  } catch (err) {
    if (err.message === 'cancelled' || !tolerant) throw err;
  }
  await sleep(700);
}

const PIPELINE_ERRORS = {
  cancelled: 'Automatisation arrêtée.',
  'no-tab': "L'onglet YouTube Studio est introuvable.",
  'continue-not-found': "Le bouton « Continuer » est introuvable.",
  'editor-still-open': "La fenêtre des emplacements ne s'est pas fermée.",
  'save-not-found': "Le bouton « Enregistrer » est introuvable.",
  'save-timeout': "L'enregistrement n'a pas abouti.",
  'verify-not-found': "Le bouton « Vérifier le placement des mid-rolls » est introuvable.",
  'editor-not-open': "L'éditeur ne s'est pas rouvert après le rechargement.",
  'insert-none': "Aucune pub n'a pu être ajoutée : vérifie que l'éditeur est ouvert.",
};

async function startAutoRun(skipConfirm = false) {
  const fill = controls.autoFill.value;
  const bySilence = settings.auto.fillMode === 'silence';

  const tab = await getStudioTab();
  if (!tab) {
    setStatus("Ouvre d'abord YouTube Studio.", 'warn');
    return;
  }

  if (!skipConfirm) {
    // Erreur la plus fréquente chez les utilisateurs : lancer l'outil pendant
    // l'envoi de la vidéo. Il ne sert qu'une fois la vidéo publiée, depuis
    // l'onglet Monétisation de ses paramètres.
    const snapshot = await probeStudio(tab);
    if (snapshot && snapshot.uploading) {
      const proceedAnyway = await askConfirm({
        title: "La vidéo n'est peut-être pas encore publiée",
        message:
          "Cette page ressemble à l'écran d'envoi ou de traitement de la vidéo. Le mode automatique " +
          "ne fonctionne qu'une fois la vidéo publiée : ouvre ses paramètres, puis l'onglet " +
          "Monétisation, avant de relancer. Continuer quand même si tu es certain d'être au bon endroit ?",
        confirmLabel: 'Continuer quand même',
        danger: true,
      });
      if (!proceedAnyway) return;
    }

    const confirmed = await askConfirm({
      title: 'Lancer le mode automatique ?',
      message:
        (bySilence
          ? `Remplissage par silences (au moins ${settings.silenceMinMs} ms, écart minimum ${formatInterval(controls.silenceGap.value)}). `
          : `Remplissage régulier, une pub toutes les ${formatInterval(fill)}. `) +
        `L'extension enregistre, recharge la page, rouvre l'éditeur, puis réduit à ${autoTargetLabel()}. ` +
        (isPinned
          ? "La fenêtre épinglée reste ouverte pendant toute l'opération."
          : "Épingle l'extension avant de lancer, sinon le parcours s'arrête dès que le popup se ferme."),
      confirmLabel: 'Lancer',
    });
    if (!confirmed) return;
  }

  await runAutoPipeline(tab, bySilence, fill);
}

async function runAutoPipeline(tab, bySilence, fill) {
  pipelineRunning = true;
  pipelineAbort = false;
  autoRun.disabled = true;
  stopButton.hidden = false;
  renderPin();

  const target =
    settings.auto.mode === 'count'
      ? { mode: 'count', count: settings.auto.count }
      : { mode: 'interval', interval: controls.autoInterval.value };

  const cooldown = settings.dev.cooldown;
  const startedAt = Date.now();

  try {
    /* --- Étape 1 : remplissage ------------------------------------------ */
    const start = await probeStudio(tab);
    const duration = (start && start.duration) || 0;

    // Nombre de pubs attendu : connu en Régulier, déduit de l'écart minimum
    // en Silence. Sert uniquement à l'estimation affichée.
    const step = bySilence ? controls.silenceGap.value : fill;
    const plannedInserts = duration ? Math.max(1, Math.floor((duration - 60) / step)) : 60;
    const plannedDeletes = Math.max(0, plannedInserts - 10);

    // Une seule estimation, pour tout le parcours.
    showEta(estimateRun({ inserts: plannedInserts, deletes: plannedDeletes, cooldown }));
    setPhase(1, bySilence ? 'Analyse des silences…' : 'Placement des pubs…');

    if (settings.auto.convert) await convertAutoBreaks(autoRun, true);
    if (pipelineAbort) throw new StepError('cancelled');

    const edges = { preRoll: settings.auto.preRoll, endRoll: settings.auto.endRoll };
    const params = bySilence
      ? {
          minSilenceSeconds: settings.silenceMinMs / 1000,
          levelPercent: settings.silenceLevel,
          minGapSeconds: controls.silenceGap.value,
          ...edges,
        }
      : { intervalSeconds: fill, ...edges };

    const [{ result: filled }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: insertAdBreaks,
      args: [bySilence ? 'silence' : 'interval', params],
      world: 'MAIN',
    });

    if (pipelineAbort) throw new StepError('cancelled');
    if (!filled) throw new StepError('insert-none');
    if (filled.error) throw new StepError(filled.error);
    if (!filled.inserted) throw new StepError('insert-none');

    /* --- Pause avant enregistrement -------------------------------------- */
    setPhase(1, `${filled.inserted} pub(s) placée(s)`);
    autoMessage.textContent = `${filled.inserted} pub(s) placée(s)`;
    await runCountdown(cooldown);
    if (pipelineAbort) throw new StepError('cancelled');

    /* --- Étape 2 : enregistrement ---------------------------------------- */
    setPhase(2, 'Enregistrement dans YouTube Studio…');
    await saveStudioChanges(tab);

    /* --- Étape 3 : rechargement ------------------------------------------ */
    setPhase(3, 'Rechargement de la page…');
    await chrome.tabs.reload(tab.id);
    await sleep(RELOAD_WAIT_SECONDS * 1000);
    if (pipelineAbort) throw new StepError('cancelled');

    setPhase(3, "Réouverture des emplacements d'annonce…");
    const reopened = await waitUntil(tab, (s) => s.editorOpen || s.hasVerify, 40000, 'verify-not-found');

    if (!reopened.editorOpen) {
      if (!(await clickStudio(tab, 'verify'))) throw new StepError('verify-not-found');
      await waitUntil(tab, (s) => s.rows > 0, 30000, 'editor-not-open');
      await sleep(2000); // laisse YouTube marquer les emplacements intrusifs
    }

    /* --- Étape 4 : nettoyage --------------------------------------------- */
    setPhase(4, 'Suppression des pubs non validées…');

    const [{ result: removed }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: removeInvalidAdBreaks,
      world: 'ISOLATED',
    });
    if (pipelineAbort) throw new StepError('cancelled');

    setPhase(4, `Réduction à ${autoTargetLabel()}…`);

    const [{ result: reduced }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: reduceAdBreaks,
      args: [target],
      world: 'ISOLATED',
    });
    if (pipelineAbort) throw new StepError('cancelled');

    hideEta();

    // Sauvegarde finale optionnelle : sans elle, le résultat reste à valider
    // à la main dans Studio.
    if (settings.auto.autoSave) {
      setPhase(4, 'Enregistrement final…');
      await saveStudioChanges(tab, true);
    }

    steps.forEach((el) => {
      el.classList.add('done');
      el.classList.remove('active');
    });
    autoProgress.hidden = true;
    clearTimers();

    const summary =
      `${filled.inserted} placée(s), ${removed || 0} non validée(s) supprimée(s), ` +
      `${reduced ? reduced.kept : 0} gardée(s) sur ${reduced ? reduced.total : 0}.`;

    setStatus(
      `Terminé : ${summary} ` + (settings.auto.autoSave ? 'Modifications enregistrées.' : SAVE_HINT),
      'ok'
    );

    finishAction({
      detail: summary,
      ads: filled.inserted + (removed || 0) + (reduced ? reduced.removed : 0),
      startedAt,
    });
  } catch (err) {
    const code = err instanceof StepError ? err.message : 'unknown';
    autoProgress.hidden = true;
    clearTimers();
    steps.forEach((el) => el.classList.remove('active'));
    setStatus(
      PIPELINE_ERRORS[code] || INSERT_ERRORS[code] || `Erreur inattendue : ${err.message}`,
      code === 'cancelled' ? 'warn' : 'err'
    );
  } finally {
    pipelineRunning = false;
    autoRun.disabled = false;
    stopButton.hidden = true;
    renderAuto();
    renderPin();
  }
}

/* ------------------------------------------------- Outils développeur */

const devCooldown = document.getElementById('dev-cooldown');
const devCooldownBadge = document.getElementById('dev-cooldown-badge');
const devConfetti = document.getElementById('dev-confetti');
const devConfettiBadge = document.getElementById('dev-confetti-badge');
const devWarningState = document.getElementById('dev-warning-state');

function renderDev() {
  const cooldown = settings.dev.cooldown;
  devCooldown.value = String(cooldown);
  devCooldown.style.setProperty('--fill', `${(cooldown / 60) * 100}%`);
  devCooldownBadge.textContent = `${cooldown} s`;

  const confetti = settings.dev.confetti;
  devConfetti.value = String(confetti);
  devConfetti.style.setProperty('--fill', `${(confetti / 30) * 100}%`);
  devConfettiBadge.textContent = `${confetti} s`;

  devWarningState.textContent = settings.silenceBetaAck
    ? 'État : masqué (tu as coché « Ne plus me le rappeler »)'
    : 'État : actif';

  document.getElementById('dev-release-state').textContent = settings.stableWelcomeSeen
    ? 'État : déjà vue'
    : 'État : sera jouée à la prochaine ouverture';

  document.getElementById('dev-profile-state').textContent =
    `Niveau ${levelOf(settings.stats.xp)} — ${settings.stats.xp} XP, ` +
    `${formatInterval(Math.round(settings.stats.savedSeconds))} gagnées`;
}

document.getElementById('dev-reset-profile').addEventListener('click', async () => {
  const confirmed = await askConfirm({
    title: 'Réinitialiser le profil ?',
    message: 'Le niveau, les XP et le temps gagné repartent de zéro.',
    confirmLabel: 'Réinitialiser',
    danger: true,
  });
  if (!confirmed) return;

  settings.stats = { xp: 0, savedSeconds: 0 };
  saveSettings();
  renderProfile();
  renderDev();
  setStatus('Profil réinitialisé.', 'ok');
});

devCooldown.addEventListener('input', () => {
  settings.dev.cooldown = Math.min(60, Math.max(0, Number(devCooldown.value) || 0));
  renderDev();
  saveSettings();
});

devConfetti.addEventListener('input', () => {
  settings.dev.confetti = Math.min(30, Math.max(0, Number(devConfetti.value) || 0));
  renderDev();
  saveSettings();
});

document.getElementById('dev-reset-warning').addEventListener('click', () => {
  settings.silenceBetaAck = false;
  saveSettings();
  renderDev();
  setStatus("L'avertissement bêta réapparaîtra au prochain passage sur Silence.", 'ok');
});

document.getElementById('dev-reset-release').addEventListener('click', () => {
  settings.stableWelcomeSeen = false;
  saveSettings();
  renderDev();
  closeSheet(sheets.dev);
  announceRelease();
});

document.getElementById('dev-fab').addEventListener('click', () => {
  renderDev();
  openSheet(sheets.dev);
});

document.getElementById('dev-close').addEventListener('click', () => closeSheet(sheets.dev));

/* ------------------------------------------------------------- Écart moyen */

document.getElementById('avg-gap-icon').addEventListener('click', async (e) => {
  const button = e.currentTarget;
  button.disabled = true;
  setStatus('Calcul en cours...', 'busy');

  try {
    const { tab, result } = await runInPage(computeAverageGap, [], 'ISOLATED');

    if (!tab) {
      setStatus("Ouvre d'abord YouTube Studio.", 'warn');
      return;
    }
    if (!result || result.count < 2) {
      setStatus(`Pas assez de pubs pour un écart moyen (${result ? result.count : 0} trouvée(s)).`, 'warn');
    } else {
      setStatus(
        `Écart moyen : ${formatInterval(Math.round(result.averageGapSeconds))} entre ${result.count} pubs.`,
        'ok'
      );
    }

    // Le résultat s'affiche tout en bas : on y amène l'utilisateur.
    revealStatus();
  } catch (err) {
    setStatus('Erreur : ' + err.message, 'err');
    revealStatus();
  } finally {
    button.disabled = false;
  }
});

/* ============================================================================
 * Presets
 * ==========================================================================*/

/* Un preset tient dans 76 bits : 5 durées (10 bits chacune), la durée mini de
 * silence, la sensibilité, et les deux objectifs. Encodés en base 32 lisible
 * (sans I, L, O ni U), cela donne 16 caractères groupés par 4.
 * Le nom ne voyage pas dans le code : il est demandé à l'import. */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 16;
const CODE_VERSION = 3; // 3 : masque des sections transportées
const PRESET_SECTIONS = [
  { key: 'auto', label: 'Auto' },
  { key: 'silence', label: 'Silence' },
  { key: 'interval', label: 'Régulier' },
  { key: 'tools', label: 'Outils' },
];
const SECTION_KEYS = PRESET_SECTIONS.map((s) => s.key);
const LEVELS = [15, 30, 45];
const LEGACY_PREFIX = 'YTAT1-';

function currentPresetData() {
  return {
    sections: SECTION_KEYS.slice(),
    intervals: { ...settings.intervals },
    silenceMinMs: settings.silenceMinMs,
    silenceLevel: settings.silenceLevel,
    sub: { ...settings.sub },
    auto: { mode: settings.auto.mode, count: settings.auto.count, convert: settings.auto.convert },
  };
}

// Un preset ne porte que les sections cochées à l'enregistrement.
function sectionsOf(data) {
  const list = Array.isArray(data.sections) ? data.sections.filter((k) => SECTION_KEYS.includes(k)) : [];
  return list.length ? list : SECTION_KEYS.slice();
}

function describePreset(data) {
  const kept = sectionsOf(data);
  const bits = [];

  if (kept.includes('auto')) {
    bits.push(
      `Auto ${data.auto.mode === 'count' ? plural(data.auto.count, 'pub') : formatInterval(data.intervals.autoInterval)}`
    );
  }
  if (kept.includes('silence')) bits.push(`Silence ${formatInterval(data.intervals.silenceGap)}`);
  if (kept.includes('interval')) bits.push(`Régulier ${formatInterval(data.intervals.insertInterval)}`);
  if (kept.includes('tools')) {
    bits.push(
      `Outils ${data.sub.mode === 'count' ? plural(data.sub.count, 'pub') : formatInterval(data.intervals.subtractive)}`
    );
  }

  return bits.join(' · ');
}

function encodePreset(preset) {
  const data = preset.data;
  const bin = (value, bits) => Math.max(0, Math.round(value)).toString(2).padStart(bits, '0').slice(-bits);
  const duration = (key) => Math.min(900, Math.max(5, Math.round(Number(data.intervals[key]) || 5))) - 5;

  const level = LEVELS.indexOf(Number(data.silenceLevel));
  // 0 à 1000 ms par pas de 10 : 0 à 100, soit 7 bits.
  const minDur = Math.min(100, Math.max(0, Math.round((Number(data.silenceMinMs) || 0) / 10)));

  // 4 bits de masque : quelles sections le code transporte.
  const kept = sectionsOf(data);
  const mask = SECTION_KEYS.reduce(
    (acc, key, index) => acc + (kept.includes(key) ? 1 << (SECTION_KEYS.length - 1 - index) : 0),
    0
  );

  const bits =
    bin(CODE_VERSION, 2) +
    bin(mask, 4) +
    bin(duration('silenceGap'), 10) +
    bin(duration('insertInterval'), 10) +
    bin(duration('subtractive'), 10) +
    bin(duration('autoFill'), 10) +
    bin(duration('autoInterval'), 10) +
    bin(minDur, 7) +
    bin(level < 0 ? 1 : level, 2) +
    bin(data.sub.mode === 'count' ? 1 : 0, 1) +
    bin(Math.min(60, Math.max(1, data.sub.count)) - 1, 6) +
    bin(data.auto.mode === 'count' ? 1 : 0, 1) +
    bin(Math.min(60, Math.max(1, data.auto.count)) - 1, 6) +
    bin(data.auto.convert ? 1 : 0, 1);

  const padded = bits.padEnd(CODE_LENGTH * 5, '0');
  let code = '';
  for (let i = 0; i < padded.length; i += 5) {
    code += CODE_ALPHABET[parseInt(padded.slice(i, i + 5), 2)];
  }
  return code.replace(/(.{4})(?=.)/g, '$1-');
}

function decodePreset(code) {
  const raw = String(code || '').trim();
  if (raw.startsWith(LEGACY_PREFIX)) return decodeLegacyPreset(raw);

  // Tolère la casse, les espaces, et les confusions classiques I/L/O/U.
  const cleaned = raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');

  if (cleaned.length !== CODE_LENGTH) return null;

  let bits = '';
  for (const char of cleaned) {
    const index = CODE_ALPHABET.indexOf(char);
    if (index < 0) return null;
    bits += index.toString(2).padStart(5, '0');
  }

  let position = 0;
  const read = (n) => {
    const value = parseInt(bits.slice(position, position + n), 2);
    position += n;
    return value;
  };

  if (read(2) !== CODE_VERSION) return null;

  const mask = read(4);
  const sections = SECTION_KEYS.filter(
    (key, index) => mask & (1 << (SECTION_KEYS.length - 1 - index))
  );
  if (sections.length === 0) return null;

  const intervals = {
    silenceGap: read(10) + 5,
    insertInterval: read(10) + 5,
    subtractive: read(10) + 5,
    autoFill: read(10) + 5,
    autoInterval: read(10) + 5,
  };

  return {
    data: {
      sections,
      intervals,
      silenceMinMs: read(7) * 10,
      silenceLevel: LEVELS[read(2)] || 30,
      sub: { mode: read(1) ? 'count' : 'interval', count: read(6) + 1 },
      auto: {
        mode: read(1) ? 'count' : 'interval',
        count: read(6) + 1,
        convert: !!read(1),
      },
    },
  };
}

// Codes de la toute première version, en base64.
function decodeLegacyPreset(raw) {
  let base64 = raw.slice(LEGACY_PREFIX.length).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';

  try {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || !parsed.d || !parsed.d.intervals) return null;
    return { name: String(parsed.n || '').slice(0, 40), data: parsed.d };
  } catch (e) {
    return null;
  }
}

// Chaque section ne touche que ses propres réglages, et seules les clés
// connues sont recopiées : un code trafiqué ne peut rien injecter d'autre.
const SECTION_INTERVALS = {
  auto: ['autoFill', 'autoInterval'],
  silence: ['silenceGap'],
  interval: ['insertInterval'],
  tools: ['subtractive'],
};

function applyPresetData(data) {
  const kept = sectionsOf(data);

  kept.forEach((section) => {
    (SECTION_INTERVALS[section] || []).forEach((key) => {
      const value = Number(data.intervals ? data.intervals[key] : NaN);
      if (Number.isFinite(value) && controls[key]) controls[key].set(value);
    });
  });

  if (kept.includes('silence')) {
    if (Number.isFinite(Number(data.silenceMinMs))) {
      settings.silenceMinMs = Math.min(1000, Math.max(0, Math.round(Number(data.silenceMinMs) / 10) * 10));
    }
    if ([15, 30, 45].includes(Number(data.silenceLevel))) {
      settings.silenceLevel = Number(data.silenceLevel);
    }
  }

  if (kept.includes('tools') && data.sub) {
    settings.sub.mode = data.sub.mode === 'count' ? 'count' : 'interval';
    settings.sub.count = Math.min(60, Math.max(1, Number(data.sub.count) || 8));
  }

  if (kept.includes('auto') && data.auto) {
    settings.auto.mode = data.auto.mode === 'count' ? 'count' : 'interval';
    settings.auto.count = Math.min(60, Math.max(1, Number(data.auto.count) || 8));
    settings.auto.convert = data.auto.convert !== false;
  }

  renderSensitivity();
  renderSilenceDuration();
  renderSubTarget();
  renderAuto();
  saveSettings();
}

const presetList = document.getElementById('preset-list');

function renderPresets() {
  if (settings.presets.length === 0) {
    presetList.innerHTML = '<div class="empty">Aucun preset enregistré pour le moment.</div>';
    return;
  }

  presetList.innerHTML = settings.presets
    .map(
      (preset, index) => `
      <div class="preset-card">
        <div class="info">
          <b></b>
          <small></small>
        </div>
        <button class="mini-btn apply" data-act="apply" data-i="${index}" title="Appliquer">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L19 7"/></svg>
        </button>
        <button class="mini-btn" data-act="copy" data-i="${index}" title="Copier le code de partage">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5h10"/></svg>
        </button>
        <button class="mini-btn danger" data-act="delete" data-i="${index}" title="Supprimer">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>
        </button>
      </div>`
    )
    .join('');

  // Les libellés sont posés en texte : un nom de preset ne peut pas injecter de HTML.
  Array.from(presetList.querySelectorAll('.preset-card')).forEach((card, index) => {
    card.querySelector('b').textContent = settings.presets[index].name;
    card.querySelector('small').textContent = describePreset(settings.presets[index].data);
  });
}

presetList.addEventListener('click', async (e) => {
  const button = e.target.closest('[data-act]');
  if (!button) return;

  const index = Number(button.dataset.i);
  const preset = settings.presets[index];
  if (!preset) return;

  if (button.dataset.act === 'apply') {
    applyPresetData(preset.data);
    closeSheet(sheets.presets);
    setStatus(`Preset « ${preset.name} » appliqué.`, 'ok');
    return;
  }

  if (button.dataset.act === 'copy') {
    const code = encodePreset(preset);
    try {
      await navigator.clipboard.writeText(code);
      setStatus(`Code copié : ${code}`, 'ok');
    } catch (err) {
      document.getElementById('preset-import').value = code;
      setStatus(`Copie impossible, code affiché ci-dessous : ${code}`, 'warn');
    }
    return;
  }

  const confirmed = await askConfirm({
    title: 'Supprimer ce preset ?',
    message: `« ${preset.name} » sera définitivement supprimé.`,
    confirmLabel: 'Supprimer',
    danger: true,
  });
  if (!confirmed) return;

  settings.presets.splice(index, 1);
  saveSettings();
  renderPresets();
});

async function askPresetName(defaultName) {
  const answer = await askConfirm({
    title: 'Nom du preset',
    message: '',
    confirmLabel: 'Enregistrer',
    prompt: { placeholder: 'Ex. : Vlogs 10 min', value: defaultName },
  });
  if (answer === false) return null;
  return String(answer).trim().slice(0, 40) || defaultName;
}

// Nom + sections à embarquer, en une seule fenêtre.
async function askPresetContent(defaultName, preselected = SECTION_KEYS) {
  const answer = await askConfirm({
    title: 'Nouveau preset',
    message: 'Choisis ce que ce preset doit retenir :',
    confirmLabel: 'Enregistrer',
    prompt: { placeholder: 'Ex. : Vlogs 10 min', value: defaultName },
    choices: PRESET_SECTIONS.map((section) => ({
      key: section.key,
      label: section.label,
      checked: preselected.includes(section.key),
    })),
  });

  if (answer === false) return null;

  const sections = answer.sections.length ? answer.sections : SECTION_KEYS.slice();
  return { name: String(answer.name).trim().slice(0, 40) || defaultName, sections };
}

function storePreset(name, data) {
  const existing = settings.presets.findIndex((p) => p.name === name);
  if (existing >= 0) settings.presets[existing] = { name, data };
  else settings.presets.push({ name, data });
  saveSettings();
  renderPresets();
}

document.getElementById('preset-save').addEventListener('click', async () => {
  const choice = await askPresetContent(`Preset ${settings.presets.length + 1}`);
  if (!choice) return;

  const data = currentPresetData();
  data.sections = choice.sections;

  storePreset(choice.name, data);
  const labels = PRESET_SECTIONS.filter((s) => choice.sections.includes(s.key)).map((s) => s.label);
  setStatus(`Preset « ${choice.name} » enregistré (${labels.join(', ')}).`, 'ok');
});

document.getElementById('preset-import-btn').addEventListener('click', async () => {
  const field = document.getElementById('preset-import');
  const preset = decodePreset(field.value);

  if (!preset) {
    setStatus('Code invalide : il doit faire 16 caractères, du type A1B2-C3D4-E5F6-G7H8.', 'err');
    return;
  }

  const name = await askPresetName(preset.name || `Preset importé ${settings.presets.length + 1}`);
  if (!name) return;

  field.value = '';
  storePreset(name, preset.data);
  applyPresetData(preset.data);
  setStatus(`Preset « ${name} » importé et appliqué.`, 'ok');
});

/* ------------------------------------------------------------------ Sheets */

document.getElementById('presets-btn').addEventListener('click', () => {
  renderPresets();
  openSheet(sheets.presets);
});

document.getElementById('presets-close').addEventListener('click', () => {
  closeSheet(sheets.presets);
});

function renderChangelog() {
  document.getElementById('changelog-version').textContent =
    `Version installée : ${versionLabel(APP_VERSION)}`;
  document.getElementById('changelog-list').innerHTML = CHANGELOG.map((entry, index) => {
    // Seule la version la plus récente porte le libellé « Nouveau ».
    const tag = index === 0 && entry.tag ? `<span class="log-tag">${entry.tag}</span>` : '';
    const bullets = entry.items.map((item) => `<li>${item}</li>`).join('');
    return `
      <div class="log-item${index === 0 ? ' latest' : ''}">
        <span class="log-dot"></span>
        <div class="log-title">
          <b>${versionLabel(entry.version)}</b>${tag}
          <span class="log-date">${entry.date}</span>
        </div>
        <ul>${bullets}</ul>
      </div>`;
  }).join('');
}

const changelogDot = document.getElementById('changelog-dot');

document.getElementById('changelog-btn').addEventListener('click', () => {
  openSheet(sheets.changelog);
  changelogDot.hidden = true;
  settings.lastSeenVersion = APP_VERSION;
  saveSettings();
});

document.getElementById('changelog-close').addEventListener('click', () => {
  closeSheet(sheets.changelog);
});
/* ============================================================================
 * Verrou : YouTube Studio requis
 * ==========================================================================*/

const gateStudio = document.getElementById('gate-studio');

async function refreshGates() {
  const tab = await getStudioTab();
  gateStudio.hidden = !!tab;
}

document.getElementById('gate-open').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://studio.youtube.com/' });
  window.close();
});

chrome.tabs.onActivated.addListener(() => refreshGates());
chrome.tabs.onUpdated.addListener((id, info) => {
  if (info.status || info.url) refreshGates();
});

refreshGates();

/* ============================================================================
 * Vérification de version
 * Le dépôt public publie un version.json ; s'il annonce plus récent que la
 * version installée, l'extension se verrouille jusqu'à la mise à jour.
 * ==========================================================================*/

const gateUpdate = document.getElementById('gate-update');
const gateUpdateText = document.getElementById('gate-update-text');
const gateUpdateNotes = document.getElementById('gate-update-notes');

function installedVersion() {
  try {
    return chrome.runtime.getManifest().version;
  } catch (e) {
    return APP_VERSION;
  }
}

function showUpdateGate(latest, info) {
  pendingUpdate = { latest, info };

  gateUpdateText.textContent =
    `Version installée ${installedVersion()}, version disponible ${latest}. ` +
    "Installe-la pour continuer à utiliser l'extension.";

  const notes = String(info.notes || '').trim();
  gateUpdateNotes.hidden = !notes;
  gateUpdateNotes.textContent = notes;

  gateUpdate.hidden = false;

  // Ouvert dans l'onglet de mise à jour : on explique la manipulation à venir.
  if (isUpdaterView) {
    updateProgress(
      "Clique sur « Mettre à jour maintenant », puis désigne le dossier de l'extension. " +
        "Cette autorisation n'est demandée qu'une fois."
    );
  }
}

async function checkForUpdate() {
  try {
    const response = await fetch(`${UPDATE_MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return;

    const info = await response.json();
    const latest = String(info.version || '').trim();
    if (!latest) return;

    if (compareVersions(latest, installedVersion()) > 0) {
      showUpdateGate(latest, info);
    } else {
      gateUpdate.hidden = true;
    }
  } catch (e) {
    // Hors ligne ou dépôt injoignable : on ne bloque pas l'extension.
  }
}

/* ---------------------------------------------------------------------------
 * Mise à jour sur place.
 *
 * Aucune API ne permet à une extension de réécrire ses propres fichiers. On
 * passe donc par l'API File System Access : tu désignes une fois le dossier de
 * l'extension, on y télécharge les nouveaux fichiers, puis on recharge.
 * L'autorisation est mémorisée, les fois suivantes se font sans rien demander.
 * -------------------------------------------------------------------------*/

const gateUpdateProgress = document.getElementById('gate-update-progress');
const gateUpdateRun = document.getElementById('gate-update-run');
const DEFAULT_UPDATE_FILES = [
  'manifest.json',
  'popup.html',
  'popup.js',
  'ico16.png',
  'ico32.png',
  'ico48.png',
  'ico128.png',
];

let pendingUpdate = null;

function updateProgress(text, isError = false) {
  gateUpdateProgress.hidden = false;
  gateUpdateProgress.textContent = text;
  gateUpdateProgress.classList.toggle('is-err', isError);
}

/* Le handle de dossier survit à la fermeture du popup : on le garde en
 * IndexedDB, seul stockage capable de conserver ce type d'objet. */
function openHandleStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('yt-ad-tool', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readSavedHandle() {
  try {
    const db = await openHandleStore();
    return await new Promise((resolve) => {
      const request = db.transaction('handles').objectStore('handles').get('extensionDir');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

async function saveHandle(handle) {
  try {
    const db = await openHandleStore();
    db.transaction('handles', 'readwrite').objectStore('handles').put(handle, 'extensionDir');
  } catch (e) {
    // Sans mémorisation, il faudra redésigner le dossier la prochaine fois.
  }
}

// Vérifie qu'on écrit bien dans le dossier de CETTE extension, pas ailleurs.
async function looksLikeExtensionFolder(handle) {
  try {
    const file = await (await handle.getFileHandle('manifest.json')).getFile();
    const parsed = JSON.parse(await file.text());
    return String(parsed.name || '').toLowerCase().includes('youtube ad tool');
  } catch (e) {
    return false;
  }
}

async function resolveExtensionFolder() {
  const saved = await readSavedHandle();

  if (saved) {
    const granted = await saved.requestPermission({ mode: 'readwrite' });
    if (granted === 'granted' && (await looksLikeExtensionFolder(saved))) return saved;
  }

  updateProgress("Choisis le dossier de l'extension dans la fenêtre qui s'ouvre…");
  const picked = await window.showDirectoryPicker({ mode: 'readwrite' });

  if (!(await looksLikeExtensionFolder(picked))) {
    throw new Error(
      "Ce dossier ne contient pas l'extension. Choisis celui où se trouve manifest.json."
    );
  }

  await saveHandle(picked);
  return picked;
}

async function runSelfUpdate() {
  if (!pendingUpdate) return;
  if (!window.showDirectoryPicker) {
    updateProgress("Ce navigateur ne permet pas l'écriture de fichiers. Passe par le téléchargement manuel.", true);
    return;
  }

  const { latest, info } = pendingUpdate;
  const ref = String(info.ref || `v${latest}`);
  const files = Array.isArray(info.files) && info.files.length ? info.files : DEFAULT_UPDATE_FILES;

  gateUpdateRun.disabled = true;

  try {
    const folder = await resolveExtensionFolder();

    // On télécharge tout avant d'écrire quoi que ce soit : si une requête
    // échoue, l'extension reste dans un état cohérent.
    const downloaded = [];
    for (let i = 0; i < files.length; i++) {
      updateProgress(`Téléchargement ${i + 1}/${files.length} — ${files[i]}`);
      const url = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${ref}/${files[i]}`;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`${files[i]} introuvable (HTTP ${response.status})`);
      downloaded.push({ name: files[i], data: await response.arrayBuffer() });
    }

    for (let i = 0; i < downloaded.length; i++) {
      updateProgress(`Installation ${i + 1}/${downloaded.length} — ${downloaded[i].name}`);
      const handle = await folder.getFileHandle(downloaded[i].name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(downloaded[i].data);
      await writable.close();
    }

    updateProgress(`Version ${latest} installée. Rechargement…`);
    setTimeout(() => chrome.runtime.reload(), 900);
  } catch (err) {
    const aborted = err && (err.name === 'AbortError' || err.name === 'NotAllowedError');
    updateProgress(
      aborted
        ? 'Mise à jour annulée. Relance quand tu veux.'
        : `Échec : ${err.message}. Tu peux télécharger la mise à jour à la main.`,
      !aborted
    );
    gateUpdateRun.disabled = false;
  }
}

gateUpdateRun.addEventListener('click', () => {
  // Un sélecteur de fichiers ferme le popup de la barre d'outils : on bascule
  // dans un onglet, où la fenêtre de choix peut s'ouvrir sans tout couper.
  if (!isUpdaterView) {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?updater=1') });
    window.close();
    return;
  }
  runSelfUpdate();
});

document.getElementById('gate-update-open').addEventListener('click', () => {
  chrome.tabs.create({ url: RELEASES_URL });
});

document.getElementById('gate-update-recheck').addEventListener('click', () => {
  gateUpdateText.textContent = 'Vérification en cours…';
  gateUpdateProgress.hidden = true;
  checkForUpdate();
});

checkForUpdate();


/* -------------------------------------------------- Restauration au départ */

renderChangelog();

chrome.storage?.local.get(['settings'], (stored) => {
  const saved = stored.settings || {};

  Object.assign(settings, saved, {
    intervals: { ...DEFAULTS.intervals, ...(saved.intervals || {}) },
    sub: { ...DEFAULTS.sub, ...(saved.sub || {}) },
    auto: { ...DEFAULTS.auto, ...(saved.auto || {}) },
    presets: Array.isArray(saved.presets) ? saved.presets : [],
  });

  Object.entries(controls).forEach(([key, control]) => control.set(settings.intervals[key]));
  renderSilenceDuration();

  applyTheme();
  renderSensitivity();
  renderSubTarget();
  renderAuto();
  renderPresets();
  renderProfile();
  showTab(settings.tab);
  changelogDot.hidden = settings.lastSeenVersion === APP_VERSION;
  renderPin();

  // Première ouverture d'une version stable, une seule fois dans la vie de
  // l'installation : ne se redéclenche pas aux mises à jour suivantes.
  if (!settings.stableWelcomeSeen && !APP_VERSION.startsWith('0.')) {
    announceRelease();
  }
});

applyTheme();
renderSensitivity();
renderSubTarget();
renderAuto();
renderPresets();
renderPin();
