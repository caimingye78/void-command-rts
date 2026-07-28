import { Game } from './game/Game.js';

const game = new Game(document.getElementById('viewport'));
game.init().catch((error) => {
  console.error(error);
  document.getElementById('loading').innerHTML = `
    <strong>INITIALIZATION FAILURE</strong>
    <small>${error.message}</small>
  `;
});
