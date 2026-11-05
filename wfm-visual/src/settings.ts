import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import Card = formattingSettings.SimpleCard;
import Model = formattingSettings.Model;

const opts = (...p: [string, string][]) => p.map(([value, displayName]) => ({ value, displayName }));
const VIEWS = opts(["intraday", "Intraday"], ["daily", "Daily"], ["weekly", "Weekly"]);
const WEEK = opts(["1", "Monday"], ["0", "Sunday"]);
const RES = opts(["hourly", "Hourly"], ["native", "Native interval"]);
const FONTS = opts(["inter", "Inter (bundled)"], ["segoe", "Segoe UI"], ["din", "DIN"], ["calibri", "Calibri"]);
const THEMES = opts(["light", "Light"], ["dark", "Dark"]);
const pick = (list: { value: string; displayName: string }[], v: string) => list.find(x => x.value === v) ?? list[0];

class GeneralCard extends Card {
    name = "general";
    displayName = "General";
    displayNameKey = "Obj_general";
    defaultView = new formattingSettings.ItemDropdown({ name: "defaultView", displayName: "Default view", displayNameKey: "Prop_defaultView", items: VIEWS, value: pick(VIEWS, "intraday") });
    weekStart = new formattingSettings.ItemDropdown({ name: "weekStart", displayName: "Week starts on", displayNameKey: "Prop_weekStart", items: WEEK, value: pick(WEEK, "1") });
    intradayResolution = new formattingSettings.ItemDropdown({ name: "intradayResolution", displayName: "Intraday resolution", displayNameKey: "Prop_intradayResolution", items: RES, value: pick(RES, "hourly") });
    fontFamily = new formattingSettings.ItemDropdown({ name: "fontFamily", displayName: "Font", displayNameKey: "Prop_fontFamily", items: FONTS, value: pick(FONTS, "inter") });
    theme = new formattingSettings.ItemDropdown({ name: "theme", displayName: "Theme", displayNameKey: "Prop_theme", items: THEMES, value: pick(THEMES, "light") });
    title = new formattingSettings.TextInput({ name: "title", displayName: "Title", displayNameKey: "Prop_title", value: "Workforce Command Center", placeholder: "Title" });
    logoUrl = new formattingSettings.TextInput({ name: "logoUrl", displayName: "Logo image URL", displayNameKey: "Prop_logoUrl", value: "", placeholder: "https:// or data:image/..." });
    slices = [this.defaultView, this.weekStart, this.intradayResolution, this.fontFamily, this.theme, this.title, this.logoUrl];
}

class ColorsCard extends Card {
    name = "colors";
    displayName = "Colors";
    displayNameKey = "Obj_colors";
    actual = new formattingSettings.ColorPicker({ name: "actual", displayName: "Actual", displayNameKey: "Prop_actual", value: { value: "#1F6FEB" } });
    forecast = new formattingSettings.ColorPicker({ name: "forecast", displayName: "Forecast", displayNameKey: "Prop_forecast", value: { value: "#F59E0B" } });
    under = new formattingSettings.ColorPicker({ name: "under", displayName: "Understaffed", displayNameKey: "Prop_under", value: { value: "#E5484D" } });
    ok = new formattingSettings.ColorPicker({ name: "ok", displayName: "On target", displayNameKey: "Prop_ok", value: { value: "#30A46C" } });
    over = new formattingSettings.ColorPicker({ name: "over", displayName: "Overstaffed", displayNameKey: "Prop_over", value: { value: "#3E63DD" } });
    slices = [this.actual, this.forecast, this.under, this.ok, this.over];
}

class SectionsCard extends Card {
    name = "sections";
    displayName = "Sections";
    displayNameKey = "Obj_sections";
    showKpis = new formattingSettings.ToggleSwitch({ name: "showKpis", displayName: "KPI strip", displayNameKey: "Prop_showKpis", value: true });
    showHeatmap = new formattingSettings.ToggleSwitch({ name: "showHeatmap", displayName: "Staffing heatmap", displayNameKey: "Prop_showHeatmap", value: true });
    showTable = new formattingSettings.ToggleSwitch({ name: "showTable", displayName: "Interval grid", displayNameKey: "Prop_showTable", value: true });
    showRoster = new formattingSettings.ToggleSwitch({ name: "showRoster", displayName: "Agent roster", displayNameKey: "Prop_showRoster", value: true });
    showWarnings = new formattingSettings.ToggleSwitch({ name: "showWarnings", displayName: "Data health warnings", displayNameKey: "Prop_showWarnings", value: true });
    slices = [this.showKpis, this.showHeatmap, this.showTable, this.showRoster, this.showWarnings];
}

export class VisualSettings extends Model {
    general = new GeneralCard();
    colors = new ColorsCard();
    sections = new SectionsCard();
    cards = [this.general, this.colors, this.sections];
}
