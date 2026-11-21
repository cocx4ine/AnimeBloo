function cleanSynopsis(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/?(?:p|div)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/[\[(]\s*source\s*:\s*[^\])\n]*[\])]/gi, '')
    .replace(/(^|\n)\s*source\s*:[^\n]*/gi, '$1')
    .replace(/(^|\s)source\s*:\s*(?:Crunchyroll|ANN|MAL|AniList|Anime News Network|Jikan|Kitsu|MyAnimeList)\b\.?/gi, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

module.exports = { cleanSynopsis };
