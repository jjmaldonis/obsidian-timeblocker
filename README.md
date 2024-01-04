# Time blocking for Obsidian

## Setup

Requires the following plugins:
- Dataview
- Time Ruler

An OpenAI API key is required, set it in the settings.

## Commands

In editor mode, select the tasks you want to schedule or unschedule.

Run either `Schedule` or `Unschedule`.

## Task Syntax

When running `Schedule`, your first task should look something like this:

`- [ ] Sneak into Area 51 [for 3 hours on Sunday at 9am]`

Additional tasks can use the previous task as a reference for when the task should be scheduled, so you can just set the duration:

`- [ ] Run away! [for 8 hours]`

The duration, date, and/or time should be at the end of the task and inside `[` brackets `]`. They can be written in human-readable words, but the recommended syntax is: `[for 30 minutes/hours/days on 12/31/2024 @ 9:00 am]` or just `[for 30 minutes/hours/days]`. If this syntax is not used, the text will be sent to ChatGPT to figure out the start time and duration of the task.
