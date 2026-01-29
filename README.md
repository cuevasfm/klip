```
  __  __   _____ 
 |  \/  | / ____|
 | \  / || |     
 | |\/| || |     
 | |  | || |____ 
 |_|  |_| \_____|
```

# Klip - Gestor de Portapapeles

Klip es un gestor de portapapeles moderno construido con [Tauri v2](https://v2.tauri.app/), [React](https://react.dev/), y [TypeScript](https://www.typescriptlang.org/). Te permite rastrear tu historial de portapapeles, buscar entre tus clips y extraer texto de imágenes usando OCR.

## Características

- **Historial del Portapapeles**: Captura automáticamente clips de texto (la captura de imágenes está desactivada por defecto).
- **Búsqueda**: Filtrado por fecha y contenido.
- **OCR (Reconocimiento Óptico de Caracteres)**: Extrae texto de imágenes manualmente.
- **Integración en Bandeja del Sistema (System Tray)**:
  - Se ejecuta en segundo plano (se minimiza a la bandeja al cerrar).
  - Menú rápido para Abrir o Salir.
- **Interfaz Inteligente**:
  - Soporte para modo Oscuro/Claro.
  - Tarjetas expandibles para texto largo.
  - Vista lado a lado para clips de imagen con texto extraído.
  - Notificaciones tipo "Toast" para acciones.

## Desarrollo

### Prerrequisitos

- [Node.js](https://nodejs.org/) (v16+)
- [Rust](https://www.rust-lang.org/tools/install) (v1.70+)
- Dependencias del sistema para Tauri (ver [Guías de Tauri](https://tauri.app/v1/guides/getting-started/prerequisites))

### Ejecutar en Modo Desarrollo

```bash
npm install
npm run tauri dev
```

### Construir para Producción

Para crear un instalador (por ejemplo, `.dmg` o `.app` para macOS):

```bash
npm run tauri build
```

Los archivos generados se ubicarán en:
- `src-tauri/target/release/bundle/dmg/`
- `src-tauri/target/release/bundle/macos/`

## Estructura del Proyecto

- **src/**: Código Frontend en React.
  - **components/**: Componentes de UI.
  - **locales/**: Archivos JSON para internacionalización (i18n).
- **src-tauri/**: Código Backend en Rust.
  - **src/lib.rs**: Lógica principal de la aplicación (Base de Datos, Monitor de Portapapeles, Bandeja).
  - **capabilities/**: Configuraciones de permisos.

## Licencia

[MIT](LICENSE)
