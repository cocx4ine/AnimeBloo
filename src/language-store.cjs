const fs = require('node:fs');
const path = require('node:path');

const supportedLanguages = Object.freeze(['it', 'en', 'fr', 'es', 'ja', 'de', 'pt-BR', 'ro']);
const defaultLanguage = 'en';
const supportedThemes = Object.freeze(['light', 'dark', 'system']);

function isSupportedTheme(value) {
  return supportedThemes.includes(value);
}

function isSupportedLanguage(value) {
  return supportedLanguages.includes(value);
}

function createLanguageStore(directory) {
  const file = path.join(directory, 'settings.json');

  function get() {
    try {
      const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
      return isSupportedLanguage(settings?.language) ? settings.language : defaultLanguage;
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return defaultLanguage;
      throw error;
    }
  }

  function set(language) {
    if (!isSupportedLanguage(language)) throw new RangeError('Unsupported language');
    fs.mkdirSync(directory, { recursive: true });
    let settings = {};
    try {
      settings = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) settings = {};
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    const temporaryFile = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporaryFile, JSON.stringify({ ...settings, language }, null, 2), 'utf8');
      fs.renameSync(temporaryFile, file);
    } catch (error) {
      try { fs.unlinkSync(temporaryFile); } catch { /* Nothing to clean up. */ }
      throw error;
    }
    return language;
  }

  function getTheme() {
    try {
      const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
      return isSupportedTheme(settings?.theme) ? settings.theme : 'dark';
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return 'dark';
      throw error;
    }
  }

  function setTheme(theme) {
    if (!isSupportedTheme(theme)) throw new RangeError('Unsupported theme');
    fs.mkdirSync(directory, { recursive: true });
    let settings = {};
    try {
      settings = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) settings = {};
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    const temporaryFile = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporaryFile, JSON.stringify({ ...settings, theme }, null, 2), 'utf8');
      fs.renameSync(temporaryFile, file);
    } catch (error) {
      try { fs.unlinkSync(temporaryFile); } catch { /* Nothing to clean up. */ }
      throw error;
    }
    return theme;
  }

  return { get, set, getTheme, setTheme };
}

module.exports = { createLanguageStore, defaultLanguage, isSupportedLanguage, isSupportedTheme, supportedLanguages, supportedThemes };
