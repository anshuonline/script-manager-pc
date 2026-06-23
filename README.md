# Script Manager PC

Script Manager PC is a premium dark-mode desktop application designed for organizing video scripts, thumbnails, and scheduling publish dates. Built with Electron, HTML, CSS, and Vanilla JavaScript, it offers a seamless and responsive user experience for content creators.

## Features

- **Rich Text Editor:** A fully functional rich text editor to write and format your video scripts.
- **Drag & Drop Teleprompter Parts:** Break your scripts into logical parts, reorder them easily with drag-and-drop, and seamlessly sync the sequence to the built-in Teleprompter.
- **Built-in Teleprompter:** Play your scripts right from your computer screen with adjustable speed, size, margins, and flipping (mirroring) options.
- **AMOLED Dark Mode:** A sleek, pure-black UI design for comfortable writing and editing.
- **Calendar & Scheduling:** Keep track of your publish dates with an interactive Calendar View.
- **Thumbnail Support:** Attach cover images/thumbnails directly to your scripts.
- **Auto-Save:** Never lose your work with built-in auto-saving.

## Installation

### Prerequisites
- Node.js (v16+)
- npm

### Setup
1. Clone this repository:
   ```bash
   git clone https://github.com/anshuonline/script-manager-pc.git
   cd script-manager-pc
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run locally for development:
   ```bash
   npm run dev
   ```
   *(or `npm start`)*

### Build for Windows (.exe)
To package the app into a standalone Windows installer:
```bash
npm run build
```
The installer will be generated in the `dist` folder.

## Tech Stack
- Electron (Desktop App Framework)
- Vanilla HTML / CSS / JavaScript (No extra UI frameworks)
- Custom Material UI-inspired ripples and shadows
- LocalStorage for data persistence

## License
MIT License
