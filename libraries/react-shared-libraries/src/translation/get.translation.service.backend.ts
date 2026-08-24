import i18next from './i18next';
import { getRequestLanguage } from './get.request.language';

const waitForInitialization = async (): Promise<void> => {
  if (i18next.isInitialized) {
    return;
  }

  await new Promise<void>((resolve) => {
    const handleInitialized = () => {
      i18next.off('initialized', handleInitialized);
      resolve();
    };
    i18next.on('initialized', handleInitialized);
  });
};

export async function getT(ns?: string, options?: any) {
  const language = await getRequestLanguage();
  await waitForInitialization();
  await i18next.loadLanguages(language);
  if (ns && !i18next.hasLoadedNamespace(ns)) {
    await i18next.loadNamespaces(ns);
  }
  return i18next.getFixedT(
    language,
    Array.isArray(ns) ? ns[0] : ns,
    options?.keyPrefix
  );
}
