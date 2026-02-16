import WebApp from "@twa-dev/sdk";

export function useTelegram() {
  const user = WebApp.initDataUnsafe?.user;
  const initData = WebApp.initData;

  return {
    tg: WebApp,
    user,
    initData,
    close: () => WebApp.close(),
    ready: () => WebApp.ready(),
    expand: () => WebApp.expand(),
    themeParams: WebApp.themeParams,
  };
}
