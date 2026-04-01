import { DefaultCommandTheme } from "./default-command-theme";
import { ThemeCommandBase, ThemeContext } from "./theme-command-base";

export const uiThemes: (typeof ThemeCommandBase)[] = [DefaultCommandTheme];

const emptyThemeContext = {} as ThemeContext;

export function getUiThemeName(ThemeCtor: typeof ThemeCommandBase): string {
  return new ThemeCtor(emptyThemeContext).name;
}

export function listUiThemes(): string[] {
  return uiThemes.map((theme) => getUiThemeName(theme));
}

export function findUiThemeByName(themeName?: string): typeof ThemeCommandBase {
  return (
    uiThemes.find((theme) => getUiThemeName(theme) === themeName) ??
    DefaultCommandTheme
  );
}

export const defaultUiThemeName = getUiThemeName(DefaultCommandTheme);
