// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, transport badge, button), in
// English and French.
// -----------------------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const API_HINT = {
  en: 'check that the Open API is on in the Marstek app (UDP port 30000 by default) and that Gladys reaches the battery',
  fr: "vérifiez que l'Open API est activée dans l'application Marstek (port UDP 30000 par défaut) et que Gladys joint la batterie",
};

export const T = {
  notConfigured: {
    en: 'No battery yet: turn on the Open API in the Marstek app, then open Discovery, or type the IP address of the battery in the configuration.',
    fr: "Aucune batterie pour l'instant : activez l'Open API dans l'application Marstek, puis ouvrez Découverte, ou saisissez l'adresse IP de la batterie dans la configuration.",
  },
  badAddresses: (list) => ({
    en: `Ignored in the configuration (an IP address or a name is expected, :port optional): ${list}.`,
    fr: `Ignoré dans la configuration (une adresse IP ou un nom est attendu, :port facultatif) : ${list}.`,
  }),
  connecting: {
    en: 'Asking the batteries…',
    fr: 'Interrogation des batteries…',
  },
  connected: (answering, total, names) => ({
    en: `${answering === total ? '' : `${answering} of `}${plural(total, 'battery answers', 'batteries answer')}: ${names}.`,
    fr: `${answering === total ? '' : `${answering} sur `}${plural(total, 'batterie répond', 'batteries répondent')} : ${names}.`,
  }),
  unreachable: (names) => ({
    en: `No answer from ${names}: ${API_HINT.en}.`,
    fr: `Pas de réponse de ${names} : ${API_HINT.fr}.`,
  }),
  badge: {
    missed: (methods) => ({
      en: `No answer to ${methods} in the last round.`,
      fr: `Pas de réponse à ${methods} au dernier relevé.`,
    }),
    resetProne: (ver) => ({
      en: `Firmware ${ver} may turn its Open API off when polled: update the battery in the Marstek app.`,
      fr: `Le firmware ${ver} peut couper son Open API quand il est interrogé : mettez la batterie à jour dans l'application Marstek.`,
    }),
  },
  test: {
    none: {
      en: `No battery found: ${API_HINT.en}, or type its IP address in the configuration.`,
      fr: `Aucune batterie trouvée : ${API_HINT.fr}, ou saisissez son adresse IP dans la configuration.`,
    },
    ok: (lines) => ({
      en: lines.map((l) => l.en).join(' '),
      fr: lines.map((l) => l.fr).join(' '),
    }),
    battery: ({ name, host, ver, rssi }) => ({
      en: `${name} at ${host}: OK (firmware ${ver ?? '?'}${rssi === undefined ? '' : `, Wi-Fi ${rssi} dBm`}).`,
      fr: `${name} à ${host} : OK (firmware ${ver ?? '?'}${rssi === undefined ? '' : `, Wi-Fi ${rssi} dBm`}).`,
    }),
    silent: (host) => ({
      en: `${host}: no answer.`,
      fr: `${host} : pas de réponse.`,
    }),
    found: (n) => ({
      en: `Discovery broadcast: ${plural(n, 'battery', 'batteries')} answered.`,
      fr: `Diffusion de découverte : ${plural(n, 'batterie a', 'batteries ont')} répondu.`,
    }),
    hint: {
      en: `For a silent battery, ${API_HINT.en}.`,
      fr: `Pour une batterie muette, ${API_HINT.fr}.`,
    },
  },
};
