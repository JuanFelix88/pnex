import { ThemeBase, ThemeContext } from "./theme-base";

export class DefaultTheme extends ThemeBase {
  public override name: string = "Default Theme";
  public override async render(ctx: ThemeContext) {
    const repoGitPath = `${ctx.directoryPath}/.git`;
    const hasRepository = await ctx.isFile(repoGitPath);

    // dir:
    const textDirectoryEl = document.createElement("div");
    textDirectoryEl.classList.add("default-theme-hud-dir");
    textDirectoryEl.innerText = ctx.directoryPath;
    ctx.elementContainer.appendChild(textDirectoryEl);

    // git branch:
    const branchRepoEl = document.createElement("div");
    branchRepoEl.classList.add("default-theme-git-status");
    branchRepoEl.classList.add("default-theme-skeleton");
    branchRepoEl.style.width = "75px";
    ctx.elementContainer.appendChild(branchRepoEl);

    // git actual user:
    const actualUser = document.createElement("div");
    actualUser.classList.add("default-theme-actual-user");
    actualUser.classList.add("default-theme-skeleton");
    actualUser.style.width = "115px";
    ctx.elementContainer.appendChild(actualUser);

    if (hasRepository) {
      const gitConfigPath = `${repoGitPath}/config`;

      const branchName = (
        await ctx.execCommand("git", ["branch", "--show-current"], {
          cwd: ctx.directoryPath,
        })
      ).trim();

      const gitConfigContent = await ctx.readFile(gitConfigPath);
      const userPartContent = gitConfigContent
        .split("[user]")
        .at(1)
        ?.split("\n");

      const repositoryUsername = userPartContent
        ?.find((line) => line.trim().startsWith("name"))
        ?.trim()
        .split("=")
        .at(1)
        ?.trim();

      const gitStatusParts = [repositoryUsername, branchName].filter(Boolean);

      // git branch:
      branchRepoEl.innerText = gitStatusParts.join(" • ");
      branchRepoEl.classList.remove("default-theme-skeleton");
      branchRepoEl.style.width = "";

      // git actual user:
      actualUser.innerText = repositoryUsername ?? "";
      actualUser.classList.remove("default-theme-skeleton");
      actualUser.style.width = "";
      if (!repositoryUsername) actualUser.remove();
    } else {
      branchRepoEl.remove();
      actualUser.remove();
    }
  }
}
