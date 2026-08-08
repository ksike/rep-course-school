# Estación meteorológica

Una **herramienta**, no un juego, y por eso está en Aplicaciones y no en Juegos: no puntúa, así que
tampoco aparece en ninguna clasificación. Es el ejemplo de las tres cosas que un juego no necesita.

```
weather-station/
├── app.json                  la ficha: qué pide, qué ajustes necesita y a quién llama
├── cover.svg                 la portada del catálogo
├── README.md                 esto
└── web/
    ├── index.html            la página
    └── weather-station.js    la herramienta entera, sin compilar ni dependencias
```

## 1. Ajustes que rellena otra persona

```jsonc
"config": [
  { "name": "city",    "scope": "user",    "required": true  },  // cada quien pone la suya
  { "name": "units",   "scope": "install", "required": false },  // lo decide el canal
  { "name": "API_KEY", "scope": "install", "secret": true    }   // cifrado; la app no lo ve nunca
]
```

Llegan en `init.config`, menos los secretos, que **no llegan nunca**. Mientras falte un ajuste
obligatorio la app se instala y se lista, pero al abrirla dice qué falta en vez de fallar.

## 2. Llamadas que hace la plataforma

La app no tiene red. Declara la petición y la nombra:

```jsonc
"externalOrigins": ["api.open-meteo.com"],
"requests": [
  { "name": "forecast", "url": "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}" }
]
```

```js
var answer = await coach.request("forecast", { lat: "42.23", lon: "-8.72" });
```

No hay ninguna URL en el código de la app, y no puede haberla: si la app eligiera el destino, todas
las comprobaciones que hay alrededor (sólo `https`, host declarado, DNS resuelto, rangos privados
bloqueados, redirecciones revisadas una a una) servirían de poco.

## 3. Un secreto que se usa sin leerse

Si tu proveedor pide clave, la escribes en la URL declarada:

```jsonc
{ "name": "forecast", "url": "https://api.example.com/v1?key={{secret:API_KEY}}" }
```

La plataforma la sustituye **al hacer la llamada**, en el servidor. Nada en `weather-station.js`
podría leerla, que es justo el punto: una app que pudiera leer su clave podría mandarla a cualquiera
de sus hosts declarados.

## Dos planos de datos

| Plano | Qué guarda aquí | Quién escribe |
|---|---|---|
| `user` | los apuntes de temperatura de cada persona | esa persona |
| `shared` | la lista de localidades que estudia la clase | quien publica la app, o su servidor |

```js
await coach.data.set("log", apuntes);              // suyo
var cities = await coach.data.get("cities", "shared");  // de todos, sólo lectura desde aquí
```

## Detalles que merecen copiarse

- La gráfica es **SVG**, así que escala y se imprime; un `canvas` sería una foto de una gráfica.
- Toda respuesta externa se lee a la defensiva: viene de un servicio que ni tú ni la plataforma
  controlan, y el día que cambie un campo la app tiene que seguir de pie.
- Los textos están en un objeto por idioma y se eligen con `init.locale`, sin librería de i18n.
