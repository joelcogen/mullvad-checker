const { app, Tray, Menu, nativeImage, navigator } = require("electron");
const path = require("path");
const TimeAgo = require("javascript-time-ago");
const en = require("javascript-time-ago/locale/en");
TimeAgo.addDefaultLocale(en);
const timeAgo = new TimeAgo("en-US");
const { exec } = require("child_process");

const DELAY = 60_000;
const TIMEOUT = 30_000;

app.dock.hide();

let tray,
  config,
  connected,
  location,
  dnsLeak,
  lastCheck,
  timeout,
  accountExpiration;
let loading = true;
let isStartup = app.getLoginItemSettings().openAtLogin;

exec(
  "mullvad account get | sed -n 2p | awk '{print $3}'",
  (error, stdout, stderr) => {
    try {
      accountExpiration = new Date(stdout);
    } catch {
      // no-op
    }
  }
);

app.whenReady().then(() => {
  const icon = nativeImage.createFromPath(path.join(__dirname, "loading.png"));
  tray = new Tray(icon);
  tray.setToolTip("Mullvad Checker");

  setInterval(setMenu, 1_000);
  check();
});

const check = async () => {
  if (timeout) {
    clearTimeout(timeout);
  }
  loading = true;

  try {
    config ||= await myFetch("https://am.i.mullvad.net/config");

    const data = await myFetch(`${config.ipv4_url}/json`);
    connected = data.mullvad_exit_ip;
    if (connected) {
      location = data.mullvad_exit_ip_hostname;

      const randomString =
        Math.random().toString(36).substring(2) +
        Math.random().toString(36).substring(2);
      const dns = await myFetch(
        `https://${randomString}.${config.dns_leak_domain}`
      );
      dnsLeak = dns[0].mullvad_dns;
    }
  } catch (error) {
    if (error.message === "fetch_error") {
      connected = false;
    } else {
      throw error;
    }
  } finally {
    lastCheck = new Date();
    loading = false;
    timeout = setTimeout(check, DELAY);
  }
};

const myFetch = (url) => {
  console.log(url);
  return fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(TIMEOUT),
  })
    .then((response) => response.json())
    .then((data) => {
      console.log(data);
      return data;
    })
    .catch((error) => {
      console.error(error);
      throw new Error("fetch_error");
    });
};

const updateTrayIcon = (iconName) => {
  const icon = nativeImage.createFromPath(
    path.join(__dirname, `${iconName}.png`)
  );
  tray.setImage(icon);
};

const setMenu = () => {
  if (lastCheck === undefined) {
    updateTrayIcon("loading");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Checking...", type: "normal", enabled: false },
        { label: "Quit", click: () => app.quit() },
      ])
    );
  } else if (connected && dnsLeak) {
    updateTrayStatus("connected", `Connected to ${location}`);
  } else if (connected && !dnsLeak) {
    updateTrayStatus(
      "disconnected",
      `Found DNS leak! (Connected to ${location})`
    );
  } else {
    updateTrayStatus("disconnected", "Not connected");
  }
};

const updateTrayStatus = (iconName, statusText) => {
  updateTrayIcon(iconName);
  tray.setContextMenu(
    Menu.buildFromTemplate(
      [
        { label: statusText, type: "normal", enabled: false },
        accountExpiration
          ? {
              label: `Expires in ${timeAgo.format(accountExpiration)}`,
              type: "normal",
              enabled: false,
            }
          : null,
        { type: "separator" },
        {
          label: loading
            ? "Checking..."
            : `Last checked ${timeAgo.format(lastCheck, "mini")} ago`,
          type: "normal",
          enabled: false,
        },
        {
          label: "Check now",
          click: () => check(),
        },
        isStartup
          ? null
          : {
              label: "Start at login",
              click: () => {
                app.setLoginItemSettings({
                  openAtLogin: true,
                  openAsHidden: true,
                  path: app.getPath("exe"),
                });
                isStartup = true;
              },
            },
        { label: "Quit", click: () => app.quit() },
      ].filter((item) => item !== null)
    )
  );
};
