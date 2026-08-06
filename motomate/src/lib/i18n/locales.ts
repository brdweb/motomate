import en from './locales/en.json';
import de from './locales/de.json';
import fr from './locales/fr.json';
import es from './locales/es.json';
import it from './locales/it.json';
import nl from './locales/nl.json';
import pt from './locales/pt.json';
import ro from './locales/ro.json';

export const locales = { en, de, fr, es, it, nl, pt, ro };
export const supportedLocales = Object.keys(locales) as (keyof typeof locales)[];

export const SUPPORTED_LANGUAGES = [
	{ code: 'en', label: 'English' },
	{ code: 'de', label: 'Deutsch' },
	{ code: 'fr', label: 'Français' },
	{ code: 'it', label: 'Italiano' },
	{ code: 'es', label: 'Español' },
	{ code: 'nl', label: 'Nederlands' },
	{ code: 'pt', label: 'Português' },
	{ code: 'ro', label: 'Română' }
] as const;
