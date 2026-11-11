/**
 * Home pages of the platforms in BGG's "Digital Implementations" families, keyed by the family
 * name without its "Digital Implementations: " prefix. BGG gives no link to the game on the
 * platform, so this is the closest link it makes possible. A platform without an entry, such as a
 * family that BGG adds later or a platform that closed, shows without a link.
 */
const digitalPlatformUrls = new Map(
  Object.entries({
    "18xx.games": "https://18xx.games/",
    "Abstract Play": "https://play.abstractplay.com/",
    AbstractBoardGames: "https://abstractboardgames.com/",
    "Ai Ai": "http://mrraow.com/index.php/aiai-home/",
    "Apple App Store": "https://apps.apple.com/",
    "Board Game Arena": "https://boardgamearena.com/",
    BoardGamePlay: "https://boardgameplay.com/",
    "Boardible (Mobile)": "https://www.boardible.com/",
    BoardSpace: "https://boardspace.net/",
    Bodogemu: "https://bodogemu.com/",
    Boiteajeux: "https://www.boiteajeux.net/",
    BrettspielWelt: "https://www.brettspielwelt.de/",
    "Dire Wolf Game Room": "https://www.direwolfdigital.com/game-room-app/",
    "Game Park": "https://game-park.com/",
    GoldToken: "https://www.goldtoken.com/",
    "Google Play": "https://play.google.com/",
    GrandGamesArena: "https://arena.grandgames.net/",
    Greenchess: "https://greenchess.net/",
    igGameCenter: "https://www.iggamecenter.com/",
    Lichess: "https://lichess.org/",
    Lidraughts: "https://lidraughts.org/",
    "Little Golem": "https://www.littlegolem.net/",
    MindSports: "https://mindsports.nl/",
    "Online Board Gamers": "https://www.onlineboardgamers.com/",
    "Play Abstract Games": "https://playabstractgames.com/",
    PlayOK: "https://www.playok.com/",
    PlayStrategy: "https://playstrategy.org/",
    Pychess: "https://www.pychess.org/",
    "Rally the Troops": "https://rally-the-troops.com/",
    "Screentop.gg": "https://screentop.gg/",
    SlothNinja: "https://www.slothninja.com/",
    Sovranti: "https://www.sovranti.com/",
    Steam: "https://store.steampowered.com/",
    "Super Duper Games": "https://www.superdupergames.org/",
    "TableTop Simulator Mod (TTS)": "https://www.tabletopsimulator.com/",
    Tabletopia: "https://tabletopia.com/",
    "Trickster's Table": "https://tricksterstable.playagame.app/",
    Triqqy: "https://triqqy.com/",
    VASSAL: "https://vassalengine.org/",
    Yucata: "https://www.yucata.de/",
  }),
);

export function digitalPlatformUrl(platform: string): string | null {
  return digitalPlatformUrls.get(platform) ?? null;
}
