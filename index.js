const axios = require("axios");
const FormData = require("form-data");
const { v4 } = require("uuid");
const estaciones = require("./estaciones.json");
const configs = require("./prod.json");
const { writeFileSync, readFile } = require("fs");

const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

// Require the necessary discord.js classes
const { Client, GatewayIntentBits } = require("discord.js");

// Create a new client instance
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
});

process.env.TZ = "America/Argentina/Buenos_Aires";

const prefix = "!";

let alerts = [];
let intervals = [];

// When the client is ready, run this code (only once)
client.once("ready", () => {
  console.log("Discord conectado.");
  readFile(configs.NAME_ALERTS_FILE, (err, data) => {
    if (err) {
      console.log(`error al levantar ${configs.NAME_ALERTS_FILE}, asegurate q exista`);
    }
    if (data) {
      const arrAlerts = JSON.parse(data);
      if (Array.isArray(arrAlerts)) {
        console.log("alertas locales levantadas con exito");
        arrAlerts.forEach((alert, index) => {
          setTimeout(() => {
            generateCaptchaAndSession(alert).then((res) => {
              if (res?.sessionId) {
                const { sessionId } = res;
                alerts.push({ ...alert, sessionId });
                console.log("Alerta levantada local activada de:", alert?.user?.username, " con ", sessionId);
                startInterval({ ...alert, sessionId });
              }
            });
          }, 5000 * index);
        });
      }
    }
  });
});

const saveAlert = (alert) => {
  if (Array.isArray(alerts)) {
    alerts.push(alert);
    writeFileSync(configs.NAME_ALERTS_FILE, JSON.stringify(alerts));
  } else {
    writeFileSync(configs.NAME_ALERTS_FILE, JSON.stringify([alert]));
  }
};

const removeAlert = (id) => {
  if (Array.isArray(alerts)) {
    alerts = alerts.filter((alert) => alert.id !== id);
    writeFileSync(configs.NAME_ALERTS_FILE, JSON.stringify(alerts));
  }
};

const startInterval = (alert) => {
  check(alert);
  const interval = setInterval(() => {
    check(alert);
  }, 10000);
  intervals.push({
    id: alert.id,
    interval,
  });
};

const pauseInterval = (id) => {
  const findInterval = intervals.find((alert) => alert.id === id);
  if (findInterval && findInterval?.interval) {
    clearInterval(findInterval.interval);
    intervals = intervals.filter((alert) => alert.id !== id);
    removeAlert(id);
  }
};

const getAlertsOfUser = (idUser) => {
  if (Array.isArray(alerts)) {
    const alertsUser = alerts.filter((alert) => alert.user.id === idUser);
    return alertsUser;
  }
  return [];
};

const getAlert = (alertToFind) => {
  if (Array.isArray(alerts)) {
    const findAlert = alerts.find((alert) => alert.user.id === alertToFind.user?.id && alert.hour === alertToFind.hour && alert.day === alertToFind.day && alert.month === alertToFind.month && alert.origin?.id_unico_estacion === alertToFind.origin?.id_unico_estacion && alert.destiny?.id_unico_estacion === alertToFind.destiny?.id_unico_estacion);
    return findAlert;
  }
  return null;
};

const existsAlert = (alertToFind) => {
  const findAlert = getAlert(alertToFind);
  return !!findAlert;
};

// Login to Discord with your client's token
client.login(configs.DISCORD_KEY);

const getCommand = (type = "avisame" | "cancelar" | "horarios") => {
  const basic = `${prefix}${type} dia(numero), mes(numero), origen(nombre), destino(nombre)`;

  if (type === "horarios") return basic;

  return `${basic}, hora de salida(opcional)`;
};

client.on("messageCreate", async (message) => {
  // ...
  // Using the new `command` variable, this makes it easier to manage!
  // You can switch your other commands to this format as well
  if (!message.content.startsWith(prefix) || message.author.bot) return;

  const [_command] = message.content.slice(prefix.length).trim().split(" ");

  if (message.content.toLowerCase() === "gracias") {
    message.channel.send(`de nada <@${message.author.id}>`);
    return;
  }

  const command = _command
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const args = message.content
    .slice(prefix.length + command.length)
    .trim()
    .split(",");

  if (command === "help") {
    message.channel.send(`<@${message.author.id}> para activar una alerta \n${getCommand("avisame")}\n\npara saber los horarios\n${getCommand("horarios")}\n`);
  } else if (command === "ping") {
    message.channel.send(`<@${message.author.id}> pong`);
  } else if (command === "avisame" || command === "cancelar" || command === "horarios") {
    if (!args.length || args.length < 4) {
      return message.channel.send(`<@${message.author.id}> faltaron campos: ${getCommand(command)}`);
    }

    const [day, month, name_origin, name_destiny, hour] = args;

    const origin = estaciones.find(
      (e) =>
        e.nombre
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "") ===
        name_origin
          .trim()
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
    );
    if (!origin) return message.channel.send(`<@${message.author.id}> no se encontro el origen "${name_origin}"`);
    const destiny = estaciones.find(
      (e) =>
        e.nombre
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "") ===
        name_destiny
          .trim()
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
    );

    if (!destiny) return message.channel.send(`<@${message.author.id}> no se encontro el destino "${name_destiny}"`);

    const parse_day = parseInt(day.trim());
    const parse_month = parseInt(month.trim());

    if (isNaN(parse_day)) return message.channel.send(`<@${message.author.id}> dia "${day}" inválido, tiene que ser un numero`);

    if (isNaN(parse_month)) return message.channel.send(`<@${message.author.id}> mes "${month}" inválido, tiene que ser un numero`);

    const now = new Date();

    if (parse_month - 1 < now.getMonth()) return message.channel.send(`<@${message.author.id}> el mes ${parse_month} ya pasó `);

    if (parse_month - 1 === now.getMonth() && parse_day < now.getDate()) return message.channel.send(`<@${message.author.id}> el día ${parse_day}/${parse_month} ya pasó`);

    const id = v4();

    let parse_hour = false;

    if (hour) {
      parse_hour = parseInt(hour?.trim());
      if (isNaN(parse_hour)) {
        return message.channel.send(`<@${message.author.id}> la hora "${hour}" es inválida, tiene que ser un numero`);
      } else {
        if (parse_hour < 10) parse_hour = `0${parse_hour}`;
      }
    }

    const alert = {
      day: parse_day,
      month: parse_month,
      year: 2023,
      hour: parse_hour,
      origin,
      destiny,
      id,
      user: message.author,
      channelId: message.channelId,
    };

    if (existsAlert(alert)) {
      if (command === "cancelar") {
        const alertToRemove = getAlert(alert);
        if (alertToRemove) {
          pauseInterval(alertToRemove.id);
          removeAlert(alertToRemove.id);
          return message.channel.send(`<@${message.author.id}> alerta desactivada.`);
        }
      } else {
        return message.channel.send(`<@${message.author.id}> ya tenes una alerta activada de ${alert.origin.nombre} a ${alert.destiny.nombre} - ${alert.day}/${alert.month}/${alert.year}${alert.hour ? ` para las ${alert.hour}` : ""}.`);
      }
    }

    if (command === "cancelar") return message.channel.send(`<@${message.author.id}> no tenes una alerta activada de ${alert.origin.nombre} a ${alert.destiny.nombre} - ${alert.day}/${alert.month}/${alert.year}${alert.hour ? ` para las ${alert.hour}` : ""}.`);

    const alertsOfUser = getAlertsOfUser(message.author.id);
    if (alertsOfUser.length >= configs.LIMIT_ALERTS_PER_USER) {
      return message.channel.send(`<@${message.author.id}> como máximo podes tener ${configs.LIMIT_ALERTS_PER_USER} alertas simultaneas.`);
    }
    try {
      const values = await generateCaptchaAndSession(alert);
      console.log({ values });
      alert.sessionId = values.sessionId;

      startInterval(alert);
      saveAlert(alert);

      return message.channel.send(`<@${message.author.id}> alerta de ${origin.nombre} a ${destiny.nombre} para el ${alert.day}/${alert.month}${alert.hour ? ` a las ${alert.hour}` : " a cualquier hora"} activada con éxito.`);
    } catch (error) {
      console.error(error);
      return message.channel.send(`<@${message.author.id}> Ocurrio un error.`);
    }
  }
});

const generateCaptchaAndSession = async ({ origin, destiny, day, month }) => {
  const year = 2023;
  const config = {
    method: "get",
    url: "https://webventas.sofse.gob.ar/index.php",
  };

  try {
    const html = await axios(config);
    const cookies = html.headers["set-cookie"];
    const sessionId = cookies?.[0]?.substring(cookies?.[0]?.indexOf("=") + 1, cookies?.[0]?.indexOf(";"));
    const indexOfCaptchaUrl = html.data.indexOf("https://webventas.sofse.gob.ar/vendor/captcha/captcha_busqueda.php");
    const captchaUrl = html.data.substring(indexOfCaptchaUrl, indexOfCaptchaUrl + 80);

    // get base64 from image

    const base64 = await fetch(captchaUrl, {
      method: "GET",
      headers: {
        Cookie: `PHPSESSID=${sessionId}`,
      },
    })
      .then(function (response) {
        return response.buffer();
      })
      .then((res) => res.toString("base64"));

    // await response resolve captcha
    const resCaptcha = await axios({
      method: "post",
      url: "https://api.apitruecaptcha.org/one/gettext",
      data: {
        apikey: "mhyMxAMnL1uBm2oujZcc",
        userid: "test_tren",
        data: base64,
      },
    });

    const captcha = resCaptcha?.data?.result;

    console.log({ captcha });

    const response = await axios(
      generatePostSearch({
        origin,
        destiny,
        day,
        month,
        year,
        captcha,
        sessionId,
      })
    );
    let data = JSON.stringify(response.data);
    let disp = data.search(`CONSULTAR DISPONIBILIDAD`);

    console.log({ disp });

    if (disp > 0) return { sessionId };
    else return null;
  } catch (error) {
    console.log(error);
    return null;
  }
};

const generatePostSearch = ({ origin, destiny, day, month, year, sessionId, captcha }) => {
  const formData = new FormData();
  formData.append("busqueda[tipo_viaje]", "1");
  formData.append("busqueda[origen]", origin.id_unico_estacion);
  formData.append("busqueda[destino]", destiny.id_unico_estacion);
  formData.append("busqueda[fecha_ida]", `${day < 10 ? `0${day}` : day}/${month < 10 ? `0${month}` : month}/${year}`);
  formData.append("busqueda[fecha_vuelta]", "");
  formData.append("busqueda[cantidad_pasajeros][adulto]", "1");
  formData.append("busqueda[cantidad_pasajeros][jubilado]", "0");
  formData.append("busqueda[cantidad_pasajeros][menor]", "0");
  formData.append("busqueda[cantidad_pasajeros][bebe]", "0");
  formData.append("captcha", captcha);

  return {
    method: "post",
    url: "https://webventas.sofse.gob.ar/servicio.php",
    headers: {
      ...formData.getHeaders(),
      Cookie: `PHPSESSID=${sessionId}`,
    },
    data: formData,
  };
};

const generatePostGetServices = ({ day, month, year, sessionId }) => {
  const formData = new FormData();
  const fecha_string = `${day < 10 ? `0${day}` : day}/${month < 10 ? `0${month}` : month}/${year}`;
  formData.append("fecha_seleccionada", fecha_string);
  formData.append("sentido", "1");
  return {
    method: "post",
    url: "https://webventas.sofse.gob.ar/ajax/servicio/obtener_servicios.php",
    headers: {
      ...formData.getHeaders(),
      Cookie: `PHPSESSID=${sessionId}`,
    },
    data: formData,
  };
};

const getServicesAvailable = (dataServices) => {
  let servicesAvailable = [];
  if (dataServices) {
    Object.keys(dataServices).forEach((service) => {
      const servicios = dataServices[service]?.servicios;
      Object.keys(servicios).forEach((servicio) => {
        const el_servicio = servicios[servicio];
        if (el_servicio) {
          const web = el_servicio.web;
          Object.keys(web).forEach((web_serie) => {
            if (web[web_serie] && web[web_serie].disponibilidad > 0) {
              servicesAvailable.push({
                serie: web_serie,
                categoria: el_servicio.categorias[web_serie]?.categoria,
                id_servicio: el_servicio.id_servicio,
                id_ramal: el_servicio.id_ramal,
                nombre_ramal: el_servicio.nombre_ramal,
                fecha_salida_salida: el_servicio.horarios?.salida?.fecha_estacion,
                hora_salida_salida: el_servicio.horarios?.salida?.hora_estacion,
                fecha_llegada: el_servicio.horarios?.llegada?.fecha_estacion,
                hora_llegada: el_servicio.horarios?.llegada?.hora_estacion,
                hora_salida: el_servicio?.horarios?.origen?.hora_estacion,
              });
            }
          });
        }
      });
    });
  }
  return servicesAvailable;
};

const check = async ({ origin, destiny, day, month, user, id, channelId, hour, sessionId }) => {
  const name = user.username;
  const id_user = user.id;
  const year = 2023;
  try {
    const getServices = await axios(generatePostGetServices({ day, month, year, sessionId }));
    const hay_disp = getServices?.data?.sin_disponibilidad === 0;
    const dataServices = getServices?.data?.servicios;
    const servicesAvailable = getServicesAvailable(dataServices);

    console.log(getServices?.data);
    console.log({ servicesAvailable });

    if (hay_disp) {
      servicesAvailable.forEach((serviceAvailable) => {
        console.log(`${new Date().toLocaleTimeString("es-ES")}: ${name} ¡LUGAR LIBRE! de ${origin.nombre} a ${destiny.nombre} - ${day}/${month}/${year} para las ${serviceAvailable?.hora_salida ?? ""}`);

        if (serviceAvailable.hora_salida?.slice(0, 2) == `${hour}` || !hour) {
          client.channels.cache.get(channelId).send(`<@${id_user}> ¡LUGAR LIBRE! de ${origin.nombre} a ${destiny.nombre} - ${day}/${month}/${year} para las ${serviceAvailable.hora_salida}`);
          if (id) pauseInterval(id);
        }
      });
    }
  } catch (error) {
    console.error(error);
  }
};
