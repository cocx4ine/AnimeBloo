export const updateCopy = {
 en: ['Release history','Check for updates','Up to date','Release information is unavailable. Showing installed version and any previously loaded releases.','Installed','Latest release','Release notes on GitHub','Release notes are not available for this version.','Streaming with buffering and episode prefetch, Anime4K v4, AniSkip and customizable themes.','Preview · v{version}','Demonstration only; no new release has been detected.','Notes in the language published by the author.','View versions','Could not open GitHub. Please try again.'],
 it: ['Storico versioni','Controlla aggiornamenti','Versione aggiornata','Informazioni sulle release non disponibili. Sono mostrate la versione installata e le release già caricate.','Installata','Ultima release','Note della release su GitHub','Note non disponibili per questa versione.','Streaming con buffer e prefetch degli episodi, Anime4K v4, AniSkip e temi personalizzabili.','Anteprima · v{version}','Solo dimostrazione; non è stata rilevata una nuova release.','Note nella lingua originale dell’autore.','Visualizza versioni','Impossibile aprire GitHub. Riprova.'],
 fr: ['Historique des versions','Rechercher des mises à jour','Version à jour','Informations indisponibles. Affichage de la version installée et des versions déjà chargées.','Installée','Dernière version','Notes de version sur GitHub','Aucune note disponible pour cette version.','Streaming avec mémoire tampon et préchargement, Anime4K v4, AniSkip et thèmes personnalisables.','Aperçu · v{version}','Démonstration uniquement ; aucune nouvelle version détectée.','Notes dans la langue originale de l’auteur.','Voir les versions','Impossible d’ouvrir GitHub. Réessayez.'],
 es: ['Historial de versiones','Buscar actualizaciones','Versión actualizada','Información no disponible. Se muestra la versión instalada y las versiones ya cargadas.','Instalada','Última versión','Notas de versión en GitHub','No hay notas disponibles para esta versión.','Streaming con búfer y precarga de episodios, Anime4K v4, AniSkip y temas personalizables.','Vista previa · v{version}','Solo demostración; no se ha detectado una nueva versión.','Notas en el idioma original del autor.','Ver versiones','No se pudo abrir GitHub. Inténtalo de nuevo.'],
 ja: ['バージョン履歴','更新を確認','最新の状態です','リリース情報を取得できません。インストール済みと取得済みのバージョンを表示します。','インストール済み','最新リリース','GitHubでリリースノートを読む','このバージョンのリリースノートはありません。','バッファリングとエピソード先読み、Anime4K v4、AniSkip、カスタムテーマに対応。','プレビュー · v{version}','表示のデモです。新しいリリースは検出されていません。','ノートは著者の原文で表示されます。','バージョンを見る','GitHubを開けませんでした。再試行してください。'],
 de: ['Versionsverlauf','Nach Updates suchen','Auf dem neuesten Stand','Versionsinformationen sind nicht verfügbar. Installierte und zuvor geladene Versionen werden angezeigt.','Installiert','Neueste Version','Versionshinweise auf GitHub','Für diese Version sind keine Hinweise verfügbar.','Streaming mit Pufferung und Folgen-Vorabladen, Anime4K v4, AniSkip und anpassbaren Designs.','Vorschau · v{version}','Nur eine Vorschau; es wurde keine neue Version gefunden.','Hinweise in der Originalsprache des Autors.','Versionen anzeigen','GitHub konnte nicht geöffnet werden. Versuche es erneut.'],
 'pt-BR': ['Histórico de versões','Verificar atualizações','Tudo atualizado','As informações de lançamento estão indisponíveis. Exibindo a versão instalada e as versões carregadas anteriormente.','Instalada','Versão mais recente','Notas de lançamento no GitHub','Não há notas disponíveis para esta versão.','Streaming com buffer e pré-carregamento de episódios, Anime4K v4, AniSkip e temas personalizáveis.','Prévia · v{version}','Apenas demonstração; nenhuma nova versão foi detectada.','Notas no idioma original do autor.','Ver versões','Não foi possível abrir o GitHub. Tente novamente.'],
 ro: ['Istoricul versiunilor','Caută actualizări','La zi','Informațiile despre versiuni nu sunt disponibile. Sunt afișate versiunea instalată și cele încărcate anterior.','Instalată','Cea mai nouă versiune','Notele versiunii pe GitHub','Nu există note pentru această versiune.','Streaming cu buffer și preîncărcarea episoadelor, Anime4K v4, AniSkip și teme personalizabile.','Previzualizare · v{version}','Doar demonstrație; nu a fost detectată nicio versiune nouă.','Note în limba originală a autorului.','Vezi versiunile','GitHub nu a putut fi deschis. Încearcă din nou.']
};
export function createUpdates({ api, t, language, escape, gsap, reduced, banner }) {
 let state = null, busy = false, checked = false;
 const copy = i => updateCopy[language()]?.[i] ?? updateCopy.en[i] ?? '';
 function markup() {
  const current = api.currentVersion;
  const releases = [...(state?.releases || [])];
  if (!releases.some(r => r.version === current)) releases.push({version: current, local: true});
  return `<section class="updates-page" aria-labelledby="updates-title"><header class="updates-header"><div><span class="section-index">05 / 06</span><h1 id="updates-title">${t('update')}<em>.</em></h1><p>${t('updateNote')}</p></div><div class="updates-actions"><button type="button" class="update-preview-button" data-check-updates ${busy ? 'disabled' : ''}>${busy ? t('versionChecking') : copy(1)}</button>${api.isDevelopment ? `<button type="button" class="release-link" data-preview-update>${t('previewUpdateBanner')}</button>` : ''}</div></header>
  <div class="version-overview"><div><span>${t('versionCurrent')}</span><strong>v${escape(current)}</strong></div><div><span>${t('versionLatest')}</span><strong>${state?.latest ? 'v'+escape(state.latest) : '—'}</strong></div></div>
  <p class="updates-status" role="status">${busy ? t('versionChecking') : !checked ? '' : state?.status === 'unavailable' || state?.historyUnavailable ? copy(3) : state?.updateAvailable ? t('newVersionAvailable').replace('{version}',escape(state.latest)) : copy(2)}</p>
  <h2>${copy(0)}</h2><div class="release-list">${releases.map(r => `<article class="release-card"><div class="release-heading"><h3>v${escape(r.version)}</h3>${r.version === current ? `<span class="release-badge">${copy(4)}</span>` : ''}${r.version === state?.latest ? `<span class="release-badge">${copy(5)}</span>` : ''}${r.date && Number.isFinite(Date.parse(r.date)) ? `<time datetime="${escape(r.date)}">${new Intl.DateTimeFormat(language(), {dateStyle:'medium'}).format(new Date(r.date))}</time>` : ''}</div><p>${escape(r.summary || (r.local && current === '0.1.0' ? copy(8) : copy(7)))}</p>${r.summary ? `<small>${copy(11)}</small>` : ''}${r.url ? `<button class="release-link" type="button" data-release-version="${escape(r.version)}"><span>${copy(6)}</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 12 12 4M5 4h7v7"/></svg></button>` : ''}</article>`).join('')}</div><p class="updates-error" role="alert"></p></section>`;
 }
 function repaint() {
  const root = document.querySelector('.updates-page');
  if (!root) return;
  const focused = root.contains(document.activeElement) ? document.activeElement.dataset.checkUpdates !== undefined : false;
  root.outerHTML = markup();
  if (focused) document.querySelector('[data-check-updates]')?.focus();
 }
 async function check(manual = false) {
  if (busy) return;
  busy = true; repaint();
  try { state = await api.getUpdateStatus() || {...state, status:"unavailable", latest:null, updateAvailable:false}; } catch { state = {...state, status:'unavailable', latest:null, updateAvailable:false}; }
  checked = true; busy = false; repaint();
  if (state?.updateAvailable) banner(state.release || {version:state.latest});
  else if (manual) banner({messageIndex:state?.status === 'ready' ? 2 : 3});
 }
 function mount() {
  if (!reduced.matches) gsap.fromTo('.release-card', {y:12,autoAlpha:0}, {y:0,autoAlpha:1,duration:.35,stagger:.045,clearProps:'all'});
  if (!checked) check();
 }
 async function open(version) {
  try { if (await api.openUpdate(version) === false) throw Error(); }
  catch { const error = document.querySelector('.updates-error'); if(error) error.textContent = copy(13); }
 }
 return {markup,mount,check,copy,open};
}
