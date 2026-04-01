import { DefaultTheme } from "./default-theme";
import { ThemeBase, ThemeContext } from "./theme-base";

export const uiThemes: (typeof ThemeBase)[] = [DefaultTheme];

const emptyThemeContext = {} as ThemeContext;

export function getUiThemeName(ThemeCtor: typeof ThemeBase): string {
  return new ThemeCtor(emptyThemeContext).name;
}

export function listUiThemes(): string[] {
  return uiThemes.map((theme) => getUiThemeName(theme));
}

export function findUiThemeByName(themeName?: string): typeof ThemeBase {
  return (
    uiThemes.find((theme) => getUiThemeName(theme) === themeName) ??
    DefaultTheme
  );
}

export const defaultUiThemeName = getUiThemeName(DefaultTheme);
