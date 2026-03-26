# FTL Save State Manager

A simple, cross-platform Electron application to manage save states for *FTL: Faster Than Light*, including full support for the **Multiverse** mod and **Hyperspace**.

## Features
- **Smart Active Tracking**: Automatically identifies which save is currently active in the game using SHA-256 hashing.
- **Interactive List**: Expandable menu for each save state with **Load**, **Update**, and **Delete** actions.
- **Cloud Sync**: Choose a custom States Folder to sync your library across devices using Google Drive, OneDrive, or Dropbox.
- **Run vs Profile**: Manage your active game sessions and global stats separately.

## How to Use
1. **Run**: Use `start.bat` (Windows) or `npm start`.
2. **Create State**: Enter a name and click "New Run State".
3. **Load State**: Click a state to expand it, then click **Load State**.
   - *Note: You must be at the FTL Main Menu for the new save to take effect.*
4. **Update State**: Click **Update (Save Here)** to overwrite an existing slot with your current game progress.

## Syncing Across Devices (Google Drive / OneDrive)
1. Install the desktop app for your cloud provider (e.g., Google Drive for Desktop).
2. In the Save State Manager, click **"Change States Folder"**.
3. Select a folder inside your cloud directory (e.g., `G:\My Drive\FTLSaves`).
4. Repeat on your other devices using the same cloud folder. Your list of states will now be mirrored.

## Installation
1. Download the latest `ftl-save-manager.exe` from the **Releases** tab on GitHub.
2. Run the executable.

## Development
- Clone the repo.
- Run `npm install`.
- Use `npm start` to run or `npm run build` to create a portable executable in the `dist/` folder.
