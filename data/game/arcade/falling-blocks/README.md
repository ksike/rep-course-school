# Bloques que caen

Un juego completo para Open Coach, y a la vez el ejemplo de cómo se escribe uno. **Tres ficheros, sin
compilar, sin dependencias.** Lo que hay en el repositorio es exactamente lo que se ejecuta.

```
falling-blocks/
├── game.json                 la ficha: qué es, qué pide y cómo se puntúa
├── cover.svg                 la portada del catálogo
├── README.md                 esto
└── web/
    ├── index.html            la página, con el enlace al kit y al SDK
    └── falling-blocks.js     el juego entero, en JavaScript de toda la vida
```

La carpeta se llama `web/` y no `dist/` a propósito: `dist` significa "salida de una compilación", y
aquí no hay ninguna. Si tu juego sí se compila, llámala `dist/` y apunta `entry` ahí; a la plataforma
le da igual el nombre, sólo lee `entry`.

## Lo mínimo para escribir el tuyo

```html
<link rel="stylesheet" href="/app/kit/v1/kit.css" />
<script src="/app/sdk/v1.js"></script>
<script src="./mi-juego.js"></script>
```

```js
var coach = OpenCoach.connect({
  onInit: function (init) {
    // init.locale, init.themeTokens, init.config, init.resume, init.canSave
    empezar(init.resume);
  },
});

coach.progress(40, "nivel-3");          // para poder decir "continuar" en vez de "empezar"
coach.event("linea", ["cuádruple"]);    // vocabulario tuyo; alimenta las áreas flojas de quien juega
coach.save({ tablero: [] });            // la partida en curso
coach.data.set("record", 12000);        // lo que sobrevive a la partida
coach.finish({ score: 12000, maxScore: 20000 });
```

Eso es todo el contrato. No hay más API que ésta.

## Lo que este juego enseña, y dónde mirarlo

| Si quieres ver… | Míralo en |
|---|---|
| Cómo se recibe el idioma, el tema y la partida guardada | `onInit`, al final de `falling-blocks.js` |
| Cómo se dibuja sin `canvas` y sin repintar de más | `buildBoard` y `paint`: una celda SVG por casilla, y sólo se toca la que cambia |
| Qué contar y con qué palabras | las llamadas a `coach.event` en `lock` y `drop` |
| Dónde va cada cosa que se guarda | `finish`: la sesión es de la plataforma, el récord es de la app, la partida se borra al terminar |
| Cómo se sigue el tema claro/oscuro sin saber nada de la plataforma | el bloque `themeTokens` de `onInit` |
| Cómo se usan nuestros iconos | `<span class="coach-icon" data-icon="pause">` en `index.html` |

## Reglas que conviene no romper

- **La app no llega a la red.** Su marco sólo permite sus propios ficheros. Si necesitas un servicio
  externo, se declara en el manifiesto y lo llama la plataforma por ti.
- **`localStorage` no existe** ahí dentro, y es a propósito: lo que guardas por el SDK va a la cuenta
  de quien juega, así que le sigue de un dispositivo a otro.
- **Puntuar es opcional.** Una herramienta que no puntúa registra que se usó; un cero falso ensucia
  todas las medias donde caiga.
- **`finish` se manda una vez.** La segunda se ignora aquí y se rechaza en el servidor.

## Probarlo sin publicar nada

Registra la carpeta del pack como repositorio local y instálalo como cualquier otro contenido; está
explicado en [`doc/CONTENT_REPOSITORIES.md`](../../../../../doc/CONTENT_REPOSITORIES.md). Cuando lo
cambies, sube la versión en `coach.json` y actualiza: la integridad se comprueba, así que editar los
ficheros sin tocar la versión se rechaza a propósito.
