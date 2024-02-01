import { App, Editor, MarkdownPostProcessorContext, MarkdownRenderChild, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, ToggleComponent } from 'obsidian';
import OpenAI from 'openai';
import { getFAIcon } from './utils';
import { faBars } from '@fortawesome/free-solid-svg-icons';
import 'drag-drop-touch';

function generateId(): string {
	return Math.random().toString(36).substr(2, 6);
}

interface TodoWithSchedule {
	timeString: string;
	taskDescription: string;
	datetime: Date,
	duration: DurationJSON, // in minutes
}

interface TimeblockingSettings {
	openAiApiKey: string;
	moveable: boolean,
}

interface DurationJSON {
	minutes?: number,
	hours?: number,
	days?: number,
}

const DEFAULT_SETTINGS: TimeblockingSettings = {
	openAiApiKey: '',
	moveable: true,
}

export default class MyPlugin extends Plugin {
	settings: TimeblockingSettings;
	openai: OpenAI;

	async onload() {
		await this.loadSettings();

		this.openai = new OpenAI({
			apiKey: this.settings.openAiApiKey,
			dangerouslyAllowBrowser: true,
		});

		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'timeblocker-schedule-tasks',
			name: 'Schedule / Reschedule',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				let selection = editor.getSelection();
				const notice = new Notice("Scheduling tasks...", 0);
				this.parseTodosWithSchedule(selection.trim()).then((todos: TodoWithSchedule[]) => {
					let todosAsText: string[] = [];
					for (let i = 0; i < todos.length; i++) {
						let todo = todos[i];
						let todoAsText = this.writeTodoAsFormattedText(todo);
						todosAsText.push(todoAsText);
					};
					const replacement = todosAsText.join("\n");
					editor.replaceSelection(replacement);
					notice.hide();
				});
			}
		});

		this.addCommand({
			id: 'timeblocker-unschedule-tasks',
			name: 'Unschedule',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				let selection = editor.getSelection();
				const notice = new Notice("Unscheduling tasks...", 0);

				let lines = selection.split("\n");
				let todosAsText: string[] = [];
				let previousLine: string | undefined = undefined;
				for (let i = 0; i < lines.length; i++) {
					let line = lines[i];
					let todo = this.parseScheduledTask(line, previousLine);
					// todosAsText.push(this.writeTodoAsText(todo));
					todosAsText.push(`${todo.taskDescription} [${todo.timeString}]`);
					previousLine = line;
				}
				const replacement = todosAsText.join("\n");
				editor.replaceSelection(replacement);

				notice.hide();
			}
		});

		this.addCommand({
			id: 'timeblocker-resort-tasks-by-completion',
			name: 'Resort Tasks By Completion',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				let selection = editor.getSelection();
				const notice = new Notice("Reordering tasks...", 0);

				let complete: string[] = [];
				let cancelled: string[] = [];
				let inprogress: string[] = [];
				let incomplete: string[] = [];
				let unknownLines: string[] = [];
				let lastPlaced: string | undefined = undefined;
				let lines = selection.split("\n");
				for (let i = 0; i < lines.length; i++) {
					let line = lines[i];
					if (line.startsWith("- [ ]")) {
						incomplete.push(line);
						lastPlaced = "INCOMPLETE";
					} else if (line.startsWith("- [x]")) {
						complete.push(line);
						lastPlaced = "COMPLETE";
					} else if (line.startsWith("- [-]")) {
						cancelled.push(line);
						lastPlaced = "CANCELLED";
					} else if (line.startsWith("- [/]")) {
						inprogress.push(line);
						lastPlaced = "INPROGRESS";
					} else if (line.startsWith("  ") || line.startsWith("	")) {
						console.log(line);
						if (lastPlaced === "COMPLETE") {
							console.log("adding to COMPLETE")
							complete.push(line);
						} else if (lastPlaced === "CANCELLED") {
							console.log("adding to CANCELLED")
							cancelled.push(line);
						} else if (lastPlaced === "INPROGRESS") {
							console.log("adding to INPROGRESS")
							inprogress.push(line);
						} else if (lastPlaced === "INCOMPLETE") {
							console.log("adding to INCOMPLETE")
							incomplete.push(line);
						} else {
							console.log("UNKNOWN", line)
							unknownLines.push(line)
						}
					} else {
						console.log("UNKNOWN0", line)
						unknownLines.push(line);
					}
				}
				const replacement = complete.join("\n") + "\n" + incomplete.join("\n") + "\n" + unknownLines.join("\n");
				editor.replaceSelection(replacement.trim());

				notice.hide();
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new TimeblockingSettingsTab(this.app, this));

		this.registerMarkdownPostProcessor((el: HTMLElement, cts: MarkdownPostProcessorContext) => {
			this.recursivelyRenderListElements(el, cts);
		}, 999999999999999);
	}

	recursivelyRenderListElements(el: HTMLElement, cts: MarkdownPostProcessorContext) {
		if (el.hasChildNodes()) {
			el.childNodes.forEach((child: ChildNode) => {
				if (child instanceof HTMLElement) {
					this.recursivelyRenderListElements(child, cts);
				}
			});
		}
		if (this.settings.moveable && el.classList.contains("task-list-item") && !(el.childNodes.item(0) as HTMLElement).hasClass("timeblocker-moveable-task-item")) {
			// As of Obsidian 1.3.0, it is required by Obsidian to create and/or pass a Component object
			// when using its Markdown rendering methods
			const childComponent = new MarkdownRenderChild(el);
			cts.addChild(childComponent);

			function dragstartHandler(ev: any) {
				// Add the target element's id to the data transfer object
				if (ev.stopPropagation) ev.stopPropagation(); // this does NOT prevent the drop event
				// if (ev.preventDefault) ev.preventDefault(); // this prevents the drop event
				// ev.cancelBubble = true;
				// ev.returnValue = false;
				ev.dataTransfer.setData("timeblocker/li", ev.target.id);
				ev.dataTransfer.effectAllowed = "move";
				// propagate up until we find the list item
				let li = ev.target as HTMLElement;
				while (li && !li.hasClass("task-list-item")) {
					li = li.parentElement as HTMLElement;
				}
				console.log("Drag start: ", li.outerText);
				// return false;
			}

			function dragoverHandler(ev: any) {
				ev.preventDefault();
				ev.dataTransfer.dropEffect = "move";
			}

			let dropHandler = (ev: any) => {
				ev.preventDefault();
				const dragged = document.getElementById(ev.dataTransfer.getData("timeblocker/li"))?.parentElement;
				if (dragged) {
					const dropped = ev.target;
					// console.log(dragged, dropped);
					// console.log("Dragged: ", dragged.outerText);
					// console.log("Drop: ", dropped.outerText);
					let draggedText = dragged.hasClass("is-checked") ? `- [x] ${dragged.outerText.trimEnd()}` : `- [ ] ${dragged.outerText.trimEnd()}`;
					let droppedText = dropped.hasClass("is-checked") ? `- [x] ${dropped.outerText.trimEnd()}` : `- [ ] ${dropped.outerText.trimEnd()}`;
					const tfile = this.app.workspace.getActiveFile();
					if (tfile !== null) {
						this.app.vault.process(tfile, (data: string) => {
							const lines = data.split("\n").map((line: string) => line.trimEnd());
							const idragged = lines.indexOf(draggedText);
							const idropped = lines.indexOf(droppedText);
							// console.log(draggedText, idragged);
							// console.log(droppedText, idropped);
							// console.log(lines);
							if (idragged >= 0 && idropped >= 0) {
								lines[idragged] = droppedText;
								lines[idropped] = draggedText;
							}
							return lines.join("\n");
						});
					}
				}
			}
			dropHandler = dropHandler.bind(this);

			const icon = el.createDiv();
			icon.appendChild(getFAIcon(faBars).node[0]);
			icon.id = generateId();
			icon.draggable = true;
			icon.ondragstart = dragstartHandler;
			icon.addClass("svg-inline--fa");
			icon.addClass("timeblocker-moveable-task-item")
			el.addEventListener("dragstart", dragstartHandler);
			if (icon !== undefined) {
				el.prepend(icon, el.childNodes.item(0));
				el.replaceWith(el);
			}
			el.ondrop = dropHandler;
			el.ondragover = dragoverHandler;
		}
	}

	async parseTodosWithSchedule(text: string): Promise<TodoWithSchedule[]> {
		let lines = text.split("\n");
		let todos: TodoWithSchedule[] = [];
		let previousMeetingEndTime = undefined;
		for (let i = 0; i < lines.length; i++) {
			console.log(`Scheduling task ${i + 1}/${lines.length}`);
			let notice = new Notice(`Scheduling task ${i + 1}/${lines.length}`, 0);
			let line = lines[i];
			let timeString = this.getTextBetweenBrackets(line);
			let taskDescription = line.replace(timeString, "").trim();
			timeString = timeString.trim();
			timeString = timeString.slice(1, timeString.length - 1);  // remove the outer brackets
			let dt: Date | undefined = undefined;
			let duration: DurationJSON | undefined = undefined;
			[dt, duration] = this.getDatetimeFromRegex(timeString, previousMeetingEndTime);
			console.log(dt, duration);
			if (dt === undefined || duration === undefined) {
				[dt, duration] = await this.getDatetimeFromChatGpt(timeString, previousMeetingEndTime);
			}
			if (dt !== undefined && duration !== undefined) {
				todos.push({
					timeString: timeString,
					taskDescription: taskDescription,
					datetime: dt,
					duration: duration,
				});
				let minutes = this.convertDurationJsonToMinutes(duration);
				if (minutes !== undefined) {
					previousMeetingEndTime = new Date(dt.getTime() + minutes * 60000);
				}
			}
			notice.hide();
			console.log(`Finished with task ${i + 1}`);
		}
		return todos;
	}

	writeTodoAsText(todo: TodoWithSchedule): string {
		let duration = this.convertDurationJsonToMinutes(todo.duration);
		let dt = this.datetimeToHumanReadable(todo.datetime);
		return `${todo.taskDescription} [for ${duration} minutes on ${dt}]`;
	}

	datetimeToHumanReadable(datetime: Date): string {
		const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
		let dayOfWeek = weekday[datetime.getDay()];
		let dayOfMonth = datetime.getDate();
		let month = datetime.getMonth() + 1;
		let year = datetime.getFullYear();
		let dayOfMonthString = dayOfMonth.toString();
		while (dayOfMonthString.length < 2) {
			dayOfMonthString = "0" + dayOfMonthString;
		}
		let monthString = month.toString();
		while (monthString.length < 2) {
			monthString = "0" + monthString;
		}
		let date = `${dayOfWeek} ${monthString}/${dayOfMonthString}/${year}`

		let hours = datetime.getHours();
		let ampm = 'am';
		if (hours > 12) {
			ampm = 'pm';
			hours = hours - 12;
		}
		let hoursString = hours.toString();
		/*while (hoursString.length < 2) {
			hoursString = "0" + hoursString;
		}*/
		let minutes = datetime.getMinutes();
		let minutesString = minutes.toString();
		while (minutesString.length < 2) {
			minutesString = "0" + minutesString;
		}

		let time = `${hoursString}:${minutesString} ${ampm}`;
		return `${date} @ ${time}`;
	}

	writeTodoAsFormattedText(todo: TodoWithSchedule): string {
		let duration = this.convertDurationJsonToMinutes(todo.duration);
		let checkbox = '';
		/*if (todo.taskDescription.trim().startsWith(`- [`)) {
			checkbox = '';
		} else {
			checkbox = `- [ ] `
		}*/
		let dayOfMonth = todo.datetime.getDate();
		let month = todo.datetime.getMonth() + 1;
		let year = todo.datetime.getFullYear();
		let dayOfMonthString = dayOfMonth.toString();
		while (dayOfMonthString.length < 2) {
			dayOfMonthString = "0" + dayOfMonthString;
		}
		let monthString = month.toString();
		while (monthString.length < 2) {
			monthString = "0" + monthString;
		}

		let hours = todo.datetime.getHours();
		let hoursString = hours.toString();
		while (hoursString.length < 2) {
			hoursString = "0" + hoursString;
		}
		let minutes = todo.datetime.getMinutes();
		let minutesString = minutes.toString();
		while (minutesString.length < 2) {
			minutesString = "0" + minutesString;
		}
		let scheduled = `[scheduled:: ${year}-${monthString}-${dayOfMonthString}T${hoursString}:${minutesString}]`
		let length = `[length:: ${duration} minutes]`
		return `${checkbox}${todo.taskDescription} ${length} ${scheduled}`;
	}

	getTextBetweenBrackets(text: string): string {
		text = text.trim();
		// if the text starts with a checkbox
		if (text.startsWith("- [ ]") || text.startsWith("- [x]")) {
			text = text.slice("- [ ]".length + 1);
		}
		let start = text.indexOf(`[`);
		if (start < 0) {
			return "";
		} else {
			text = text.slice(start, undefined);
			let end = text.indexOf(`]`);
			if (end < 0) {
				return "";
			} else {
				text = text.slice(0, end + 1);
				return text;
			}
		}
	}

	convertDurationJsonToMinutes(j: DurationJSON): number | undefined {
		if (j.minutes === undefined && j.hours === undefined && j.days === undefined) {
			return undefined;
		}
		return (j.minutes || 0) + ((j.hours || 0) * 60) + ((j.days || 0) * 60 * 24);
	}

	getDatetimeFromRegex(timeString: string, lastKnownDatetime: Date | undefined): [Date | undefined, DurationJSON | undefined] {
		const daysRegex = /^for (?<duration>\d+) day[s]?$/gm;
		if (timeString.match(daysRegex)) {
			let days = Number(daysRegex.exec(timeString)!.groups!.duration);
			return [lastKnownDatetime, { days }];
		}
		const hoursRegex = /^for (?<duration>\d+) hour[s]?$/gm;
		if (timeString.match(hoursRegex)) {
			let hours = Number(hoursRegex.exec(timeString)!.groups!.duration);
			return [lastKnownDatetime, { hours }];
		}
		const minutesRegex = /^for (?<duration>\d+) minute[s]?$/gm;
		if (timeString.match(minutesRegex)) {
			let minutes = Number(minutesRegex.exec(timeString)!.groups!.duration);
			return [lastKnownDatetime, { minutes }];
		}
		const fullRegex = /^for (?<duration>\d+) (?<unit>minute|hour|day)[s]? on (Sunday|Monday|Tuesday|Wednesday|Thursday|Friday)?( )?(?<date>\d+\/\d+\/\d+) @ (?<time>\d+:\d+) (?<ampm>am|pm)$/gm;
		if (timeString.match(fullRegex)) {
			const groups = fullRegex.exec(timeString)!.groups!;
			const date = groups.date;
			const time = groups.time;
			const unit = groups.unit + "s";
			const ampm = groups.ampm;
			const dt = new Date(`${date} ${time} ${ampm}`);
			const duration = groups.duration;
			const durationJson = JSON.parse(`{"${unit}": ${duration}}`) as DurationJSON;
			return [dt, durationJson];
		}
		return [undefined, undefined];
	}

	async getDatetimeFromChatGpt(timeString: string, lastKnownDatetime: Date | undefined): Promise<[Date | undefined, DurationJSON | undefined]> {
		let now = new Date();
		let durationPrompt = `The following text contains a duration in minutes, hours, or days. What is the duration? Output the duration in JSON with the following format: {"minutes": <minutes>, "hours": <hours>, "days", <days>}. Do not convert days to hours or hours to minutes. Here is the text:\n\n${timeString}`
		let initialMessage = `Today is ${now.toLocaleString()} and your colleage is scheduling a meeting AFTER today. The meeting is ${timeString}. What is the date and time of the meeting? (Do not add the duration of the meeting to the start time.) Format the response as JSON and include a \`datetime\` field with the date and time of the meeting in ISO-8601 format.`;
		// let datetimePrompt = `Today is ${now.toLocaleString()} and your colleage is scheduling a meeting AFTER today. The meeting is ${timeString}. What is the date and time of the meeting? (Do not add the duration of the meeting to the start time.) Format the response as JSON and include a \`datetime\` field with the date and time of the meeting in ISO-8601 format, as well as a \`duration\` field with the duration of the meeting in minutes.`
		let datetimePrompt = `Today is ${now.toLocaleString()} and your colleage is scheduling a meeting AFTER today. The meeting is ${timeString}. What is the date and time of the meeting? (Do not add the duration of the meeting to the start time.) Format the response as JSON and include a \`datetime\` field with the date and time of the meeting in ISO-8601 format.`;
		if (lastKnownDatetime !== undefined) {
			// datetimePrompt = `Your colleage is scheduling a meeting. The previous meeting ended at ${lastKnownDatetime}. The following information will include the duration of the new meeting and may include the day and/or time when the new meeting should start: ${timeString}. If the new meeting time is specified, use that time; otherwise schedule the meeting to start when the previous meeting ended. What is the date and time of the new meeting? (Do not add the duration of the meeting to the start time.) Format the response as JSON and include a \`datetime\` field with the date and time of the meeting in ISO-8601 format, as well as a \`duration\` field with the duration of the meeting in minutes.`;
			datetimePrompt = `Your colleage is scheduling a meeting. The previous meeting ended at ${lastKnownDatetime}. The following information will include the duration of the new meeting and may include the day and/or time when the new meeting should start: ${timeString}. If the new meeting time is specified, use that time; otherwise schedule the meeting to start when the previous meeting ended. What is the date and time of the new meeting? (Do not add the duration of the meeting to the start time.) Format the response as JSON and include a \`datetime\` field with the date and time of the meeting in ISO-8601 format.`;
			initialMessage = `Your colleage is scheduling a meeting. The previous meeting ended at ${lastKnownDatetime}. The following information will include the duration of the new meeting and may include the day and/or time when the new meeting should start: ${timeString}. If the new meeting time is specified, use that time; otherwise schedule the meeting to start when the previous meeting ended. What is the date and time of the new meeting? (Do not add the duration of the meeting to the start time.) Format the response as JSON and include a \`datetime\` field with the date and time of the meeting in ISO-8601 format.`;
		}
		try {
			const durationResponse = await this.openai.chat.completions.create({
				model: 'gpt-3.5-turbo-1106',
				response_format: { "type": "json_object" },
				messages: [{ role: "user", content: durationPrompt }],
			});
			let durationResult = durationResponse.choices[0].message.content?.trim();
			if (durationResult !== undefined) {
				const datetimeResponse = await this.openai.chat.completions.create({
					// model: 'gpt-3.5-turbo-1106',
					model: 'gpt-4-1106-preview',
					response_format: { "type": "json_object" },
					messages: [{ role: "user", content: "The JSON in the next message contains the duration of a meeting:" }, { role: "user", content: durationResult }, { role: "user", content: datetimePrompt }],
				});
				let datetimeResult = datetimeResponse.choices[0].message.content?.trim();
				if (datetimeResult != undefined) {
					let durationJson = JSON.parse(durationResult) as DurationJSON;
					let datetimeJson = JSON.parse(datetimeResult);
					let datetime = new Date(datetimeJson.datetime);
					return [datetime, durationJson];
				} else {
					throw new Error("LLM datetime result is `undefined`");
				}
			} else {
				throw new Error("LLM duration result is `undefined`");
			}
		} catch (err) {
			console.error(err);
			new Notice(`Unable to generate datetime:\n\n${err}`);
		}
		return [undefined, undefined];
	}

	parseScheduledTask(task: string, previousTask: string | undefined): TodoWithSchedule {
		// Parse the previous task
		let previousTodo: TodoWithSchedule | undefined = undefined;
		if (previousTask !== undefined) {
			previousTodo = this.parseScheduledTask(previousTask, undefined);
		}

		// Keep track of the initial indentation
		let indentation = '';
		for (let i = 0; i < task.length; i++) {
			let c = task[i];
			if (c === ' ' || c === '\t') {
				indentation = indentation + c;
			} else {
				break;
			}
		}
		task = task.trim();

		// Get the length of the task
		let lengthStartIndex = task.indexOf("[length::");
		let startOfLengthString = task.slice(lengthStartIndex);
		let lengthEndIndex = startOfLengthString.indexOf("]") + lengthStartIndex;
		let lengthString = task.slice(lengthStartIndex + "[length::".length, lengthEndIndex);
		let minutesString = lengthString.replace("minutes", "").trim();
		let minutes = Number(minutesString);

		// Remove the [length:: ...] part of the string
		let split = task.split('');
		split.splice(lengthStartIndex, lengthEndIndex - lengthStartIndex + 1);
		task = split.join('');

		// Get the datetime of the task
		let dtStartIndex = task.indexOf("[scheduled::");
		let startOfDtString = task.slice(dtStartIndex);
		let dtEndIndex = startOfDtString.indexOf("]") + dtStartIndex;
		let dtString = task.slice(dtStartIndex + "[scheduled::".length, dtEndIndex);
		let datetimeString = dtString.trim();
		let datetime = new Date(datetimeString);

		// Remove the [scheduled:: ...] part of the string
		split = task.split('');
		split.splice(dtStartIndex, dtEndIndex - dtStartIndex + 1);
		task = split.join('');

		while (task.contains("  ")) {
			task = task.replace("  ", " ");
		}

		let timeString = `for ${this.maybeConvertMinutesToHoursOrDays(minutes)}`;
		// Add the date/time iff the current task is not immediately after the previous task
		let addDateTime = true;
		if (previousTodo !== undefined) {
			let previousMinutes = this.convertDurationJsonToMinutes(previousTodo.duration);
			if (previousMinutes !== undefined) {
				let previousMeetingEndTime = new Date(previousTodo.datetime.getTime() + previousMinutes * 60000);
				if (previousMeetingEndTime.toISOString() === datetime.toISOString()) {
					addDateTime = false;
				}
			}
		}
		if (addDateTime) {
			timeString = timeString + ` on ${this.datetimeToHumanReadable(datetime)}`;
		}

		return {
			datetime: datetime,
			duration: { minutes: minutes },
			taskDescription: indentation + task,
			timeString: timeString,
		}
	}

	maybeConvertMinutesToHoursOrDays(minutes: number): string {
		let days = Math.floor(minutes / (60 * 24));
		let hours = Math.floor(minutes / 60);
		if (days * 24 * 60 === minutes) {
			if (days === 1) {
				return `1 day`;
			} else {
				return `${days} days`;
			}
		}
		if (hours * 60 === minutes) {
			if (hours === 1) {
				return `1 hour`;
			} else {
				return `${hours} hours`;
			}
		}
		return `${minutes} minutes`;
	}

	onunload() { }

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class TimeblockingSettingsTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	async display(): Promise<void> {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('OpenAI API Key')
			.addText(text => text
				.setPlaceholder('Enter your OpenAI API key')
				.setValue(this.plugin.settings.openAiApiKey)
				.onChange(async (value) => {
					this.plugin.settings.openAiApiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Enable drag and drop')
			.addToggle((toggle: ToggleComponent) => {
				toggle.setValue(this.plugin.settings.moveable)
					.onChange(async (value: boolean) => {
						this.plugin.settings.moveable = value;
						await this.plugin.saveSettings();
					})
			});
	}
}


/*
- [ ] Call mom [on Monday at 3pm for 45 minutes]
- [ ] Prep food= for xmas [Monday, 3:45pm, 4 hours]
Text David [1 hour 15 minutes]
- [ ] Write superfoods ideas [for 60 minutes]
- [ ] Call gpa [1 day]
*/