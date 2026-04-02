import { ThemeCommandBase, ThemeContext } from "./theme-command-base";

// cspell:ignore pnex

const svgBranch = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="currentColor" d="M13,12.277v-5.16l-8-1V3.723C5.595,3.376,6,2.738,6,2c0-1.105-0.895-2-2-2C2.895,0,2,0.895,2,2 c0,0.738,0.405,1.376,1,1.723v8.555C2.405,12.624,2,13.261,2,14c0,1.104,0.895,2,2,2c1.105,0,2-0.896,2-2 c0-0.739-0.405-1.376-1-1.723V8.133l6,0.75v3.395c-0.595,0.346-1,0.984-1,1.723c0,1.104,0.895,2,2,2c1.105,0,2-0.896,2-2 C14,13.261,13.595,12.624,13,12.277z"/></svg>`;
const svgEarth = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M 12 2 C 10.806 2 9.5241875 3.7110625 8.7421875 6.4140625 C 8.6581875 6.7050625 8.8854531 7 9.1894531 7 L 14.810547 7 C 15.113547 7 15.339859 6.7050625 15.255859 6.4140625 C 14.474859 3.7110625 13.194 2 12 2 z M 7.0605469 3.4160156 C 6.9676406 3.4045938 6.8683906 3.4229687 6.7753906 3.4804688 C 5.6123906 4.1974688 4.6082187 5.1476719 3.8242188 6.2636719 C 3.6062188 6.5736719 3.8143594 7 4.1933594 7 L 6.1503906 7 C 6.3623906 7 6.54475 6.8495781 6.59375 6.6425781 C 6.81875 5.6965781 7.1005469 4.8277812 7.4355469 4.0507812 C 7.5660469 3.7500312 7.3392656 3.4502812 7.0605469 3.4160156 z M 16.939453 3.4160156 C 16.660688 3.4503281 16.43275 3.7512344 16.5625 4.0527344 C 16.8975 4.8287344 17.18225 5.6985312 17.40625 6.6445312 C 17.45625 6.8505312 17.637609 7 17.849609 7 L 19.806641 7 C 20.185641 7 20.393781 6.5736719 20.175781 6.2636719 C 19.391781 5.1476719 18.387609 4.1984688 17.224609 3.4804688 C 17.131609 3.4229687 17.032375 3.4045781 16.939453 3.4160156 z M 2.8125 9 C 2.6055 9 2.4173281 9.1369375 2.3613281 9.3359375 C 2.1263281 10.184937 2 11.077 2 12 C 2 12.923 2.1263281 13.815063 2.3613281 14.664062 C 2.4163281 14.863063 2.6055 15 2.8125 15 L 5.6738281 15 C 5.9458281 15 6.1539531 14.769047 6.1269531 14.498047 C 6.0469531 13.696047 6 12.864 6 12 C 6 11.136 6.0469531 10.303953 6.1269531 9.5019531 C 6.1539531 9.2309531 5.9458281 9 5.6738281 9 L 2.8125 9 z M 8.6113281 9 C 8.3773281 9 8.1783906 9.1703438 8.1503906 9.4023438 C 8.0543906 10.225344 8 11.094 8 12 C 8 12.906 8.0543906 13.774656 8.1503906 14.597656 C 8.1783906 14.829656 8.3773281 15 8.6113281 15 L 15.388672 15 C 15.622672 15 15.822609 14.829656 15.849609 14.597656 C 15.946609 13.774656 16 12.906 16 12 C 16 11.094 15.945609 10.225344 15.849609 9.4023438 C 15.821609 9.1703437 15.622672 9 15.388672 9 L 8.6113281 9 z M 18.326172 9 C 18.054172 9 17.846047 9.2309531 17.873047 9.5019531 C 17.953047 10.303953 18 11.136 18 12 C 18 12.864 17.953047 13.696047 17.873047 14.498047 C 17.846047 14.769047 18.054172 15 18.326172 15 L 21.1875 15 C 21.3945 15 21.582672 14.863063 21.638672 14.664062 C 21.873672 13.815063 22 12.923 22 12 C 22 11.077 21.873672 10.184937 21.638672 9.3359375 C 21.583672 9.1369375 21.3945 9 21.1875 9 L 18.326172 9 z M 4.1933594 17 C 3.8143594 17 3.6062187 17.426328 3.8242188 17.736328 C 4.6082187 18.852328 5.6123906 19.801531 6.7753906 20.519531 C 7.1473906 20.749531 7.6105 20.349266 7.4375 19.947266 C 7.1025 19.171266 6.81775 18.301469 6.59375 17.355469 C 6.54375 17.149469 6.3623906 17 6.1503906 17 L 4.1933594 17 z M 9.1894531 17 C 8.8864531 17 8.6601406 17.294937 8.7441406 17.585938 C 9.5251406 20.288937 10.806 22 12 22 C 13.194 22 14.475812 20.288937 15.257812 17.585938 C 15.341812 17.294937 15.114547 17 14.810547 17 L 9.1894531 17 z M 17.849609 17.001953 C 17.637609 17.000953 17.45525 17.150422 17.40625 17.357422 C 17.18125 18.303422 16.899453 19.172219 16.564453 19.949219 C 16.391453 20.351219 16.851609 20.750484 17.224609 20.521484 C 18.387609 19.804484 19.391781 18.854281 20.175781 17.738281 C 20.393781 17.428281 20.185641 17.001953 19.806641 17.001953 L 17.849609 17.001953 z"/></svg>`;
const svgHome = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><path fill="currentColor" d="M 15 2 A 1 1 0 0 0 14.300781 2.2851562 L 3.3925781 11.207031 A 1 1 0 0 0 3.3554688 11.236328 L 3.3183594 11.267578 L 3.3183594 11.269531 A 1 1 0 0 0 3 12 A 1 1 0 0 0 4 13 L 5 13 L 5 24 C 5 25.105 5.895 26 7 26 L 23 26 C 24.105 26 25 25.105 25 24 L 25 13 L 26 13 A 1 1 0 0 0 27 12 A 1 1 0 0 0 26.681641 11.267578 L 26.666016 11.255859 A 1 1 0 0 0 26.597656 11.199219 L 25 9.8925781 L 25 6 C 25 5.448 24.552 5 24 5 L 23 5 C 22.448 5 22 5.448 22 6 L 22 7.4394531 L 15.677734 2.2675781 A 1 1 0 0 0 15 2 z M 18 15 L 22 15 L 22 23 L 18 23 L 18 15 z"/></svg>`;

export class DefaultCommandTheme extends ThemeCommandBase {
  public override name: string = "Default Theme";
  private hasRepository = false;
  private branchName = "";
  private repositoryUsername = "";
  private isLoaded = false;
  private startCommand: Date | null = null;
  private endCommand: Date | null = null;
  private get commandTimeDisplay(): string | null {
    if (this.startCommand === null || this.endCommand === null) {
      return null;
    }
    const totalMs = this.endCommand.valueOf() - this.startCommand.valueOf();
    const totalSeconds = Math.floor(totalMs / 1000);
    const ms = totalMs % 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes > 0) {
      return `${minutes}m and ${seconds}s`;
    }
    return `(${seconds}s and ${ms}ms)`;
  }

  public override async onInitialLoad(): Promise<void> {
    const ctx = this.context;
    const repoGitPath = ctx.resolvePath(ctx.directoryPath, `.git`);
    const gitConfigPath = ctx.resolvePath(repoGitPath, `config`);

    this.hasRepository = await ctx.isFile(gitConfigPath);

    if (!this.hasRepository) {
      this.isLoaded = true;
      this.doRender();
      return;
    }

    const [branchNameRaw, gitConfigContent] = await Promise.all([
      ctx.execCommand("git", ["branch", "--show-current"], {
        cwd: ctx.directoryPath,
      }),
      ctx.readFile(gitConfigPath),
    ]);

    this.branchName = branchNameRaw.trim();

    const userPartContent = gitConfigContent.split("[user]").at(1)?.split("\n");
    this.repositoryUsername =
      userPartContent
        ?.find((line) => line.trim().startsWith("name"))
        ?.trim()
        .split("=")
        .at(1)
        ?.trim() ?? "";

    this.isLoaded = true;
    this.doRender();
  }

  public override async render(ctx: ThemeContext) {
    ctx.clearUi();

    if (this.status === "running" && this.startCommand === null) {
      this.startCommand = new Date();
    }

    if (
      (this.status === "success" || this.status === "error") &&
      this.endCommand === null
    ) {
      this.endCommand = new Date();
    }

    // hr:
    const separatorEl = document.createElement("hr");
    separatorEl.classList.add("default-theme-separator");
    ctx.elementContainer.appendChild(separatorEl);

    // status:
    const statusEl = document.createElement("span");
    statusEl.classList.add("default-theme-status-dot");
    statusEl.innerHTML = "•";
    statusEl.dataset.status = this.status;
    ctx.elementContainer.appendChild(statusEl);

    // dir:
    const textDirectoryEl = document.createElement("div");
    textDirectoryEl.classList.add("default-theme-hud-dir");
    textDirectoryEl.dataset.status = this.status;
    textDirectoryEl.innerText = ctx.directoryPath;
    ctx.elementContainer.appendChild(textDirectoryEl);

    // icons dir:
    if (
      textDirectoryEl.innerText.startsWith("/c/www") ||
      textDirectoryEl.innerText.startsWith("/var/www")
    ) {
      const text = textDirectoryEl.innerText.split("www/").at(1) ?? "";
      textDirectoryEl.innerHTML = `<span class="default-theme-dir-icon">${svgEarth}/</span><span>${text}</span>`;
    } else if (
      textDirectoryEl.innerText
        .toLowerCase()
        .startsWith(`/c/Users/${ctx.username}`.toLowerCase())
    ) {
      const text =
        textDirectoryEl.innerText.split(ctx.username + "/").at(1) ?? "";
      textDirectoryEl.innerHTML = `<span class="default-theme-dir-icon">${svgHome}/</span><span>${text}</span>`;
    }
    // git branch:
    const branchRepoEl = document.createElement("div");
    branchRepoEl.classList.add("default-theme-git-status");
    branchRepoEl.dataset.status = this.status;
    ctx.elementContainer.appendChild(branchRepoEl);

    // git actual user:
    const repositoryUsernameEl = document.createElement("div");
    repositoryUsernameEl.classList.add("default-theme-git-actual-user");
    repositoryUsernameEl.dataset.status = this.status;
    ctx.elementContainer.appendChild(repositoryUsernameEl);

    // command time:
    if (this.commandTimeDisplay) {
      const commandTimeEl = document.createElement("div");
      commandTimeEl.classList.add("default-theme-command-time");
      commandTimeEl.dataset.status = this.status;
      commandTimeEl.innerText = this.commandTimeDisplay;
      ctx.elementContainer.appendChild(commandTimeEl);
    }

    if (!this.isLoaded) {
      branchRepoEl.classList.add("default-theme-skeleton");
      branchRepoEl.style.width = "65px";
      repositoryUsernameEl.classList.add("default-theme-skeleton");
      repositoryUsernameEl.style.width = "85px";
      return;
    }

    if (!this.hasRepository) {
      branchRepoEl.remove();
      repositoryUsernameEl.remove();
      return;
    }

    branchRepoEl.innerHTML = `<span>(</span>${svgBranch}<span>${this.branchName})</span>`;
    branchRepoEl.style.width = "";

    repositoryUsernameEl.innerText = this.repositoryUsername;
    repositoryUsernameEl.innerText = `[${repositoryUsernameEl.innerText}]`;
    repositoryUsernameEl.style.width = "";

    if (!this.repositoryUsername) {
      repositoryUsernameEl.remove();
    }
  }
}

function mapStatusToDotVariant(status: DefaultCommandTheme["status"]): string {
  switch (status) {
    case "success":
      return "success";
    case "error":
      return "error";
    case "running":
      return "running";
    default:
      return "running";
  }
}
