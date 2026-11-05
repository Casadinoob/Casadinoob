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
    defaultView = new formattingSettings.ItemDropdown({ name: "defaultView", displayName: "Default view", items: VIEWS, value: pick(VIEWS, "intraday") });
    weekStart = new formattingSettings.ItemDropdown({ name: "weekStart", displayName: "Week starts on", items: WEEK, value: pick(WEEK, "1") });
    intradayResolution = new formattingSettings.ItemDropdown({ name: "intradayResolution", displayName: "Intraday resolution", items: RES, value: pick(RES, "hourly") });
    fontFamily = new formattingSettings.ItemDropdown({ name: "fontFamily", displayName: "Font", items: FONTS, value: pick(FONTS, "inter") });
    theme = new formattingSettings.ItemDropdown({ name: "theme", displayName: "Theme", items: THEMES, value: pick(THEMES, "light") });
    title = new formattingSettings.TextInput({ name: "title", displayName: "Title", value: "Workforce Command Center", placeholder: "Title" });
    logoUrl = new formattingSettings.TextInput({ name: "logoUrl", displayName: "Logo image URL", value: "", placeholder: "https:// or data:image/..." });
    slices = [this.defaultView, this.weekStart, this.intradayResolution, this.fontFamily, this.theme, this.title, this.logoUrl];
}

class ColorsCard extends Card {
    name = "colors";
    displayName = "Colors";
    actual = new formattingSettings.ColorPicker({ name: "actual", displayName: "Actual", value: { value: "#1F6FEB" } });
    forecast = new formattingSettings.ColorPicker({ name: "forecast", displayName: "Forecast", value: { value: "#F59E0B" } });
    under = new formattingSettings.ColorPicker({ name: "under", displayName: "Understaffed", value: { value: "#E5484D" } });
    ok = new formattingSettings.ColorPicker({ name: "ok", displayName: "On target", value: { value: "#30A46C" } });
    over = new formattingSettings.ColorPicker({ name: "over", displayName: "Overstaffed", value: { value: "#3E63DD" } });
    slices = [this.actual, this.forecast, this.under, this.ok, this.over];
}

class TargetsCard extends Card {
    name = "targets";
    displayName = "Targets";
    serviceLevelTarget = new formattingSettings.NumUpDown({ name: "serviceLevelTarget", displayName: "Service level target (%)", value: 80 });
    accuracyTarget = new formattingSettings.NumUpDown({ name: "accuracyTarget", displayName: "Forecast accuracy target (%)", value: 90 });
    staffingTolerance = new formattingSettings.NumUpDown({ name: "staffingTolerance", displayName: "Staffing tolerance (± %)", value: 5 });
    slices = [this.serviceLevelTarget, this.accuracyTarget, this.staffingTolerance];
}

class SectionsCard extends Card {
    name = "sections";
    displayName = "Sections";
    showKpis = new formattingSettings.ToggleSwitch({ name: "showKpis", displayName: "KPI strip", value: true });
    showHeatmap = new formattingSettings.ToggleSwitch({ name: "showHeatmap", displayName: "Staffing heatmap", value: true });
    showTable = new formattingSettings.ToggleSwitch({ name: "showTable", displayName: "Interval grid", value: true });
    showRoster = new formattingSettings.ToggleSwitch({ name: "showRoster", displayName: "Agent roster", value: true });
    slices = [this.showKpis, this.showHeatmap, this.showTable, this.showRoster];
}

export class VisualSettings extends Model {
    general = new GeneralCard();
    colors = new ColorsCard();
    targets = new TargetsCard();
    sections = new SectionsCard();
    cards = [this.general, this.colors, this.targets, this.sections];
}
