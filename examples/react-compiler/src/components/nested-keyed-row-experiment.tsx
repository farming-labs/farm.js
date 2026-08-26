"use client";

import { useState } from "react";

interface NestedTask {
  id: string;
  label: string;
  done: boolean;
}

interface NestedProject {
  id: string;
  label: string;
  tasks: NestedTask[];
}

const initialProjects: NestedProject[] = Array.from({ length: 256 }, (_, projectIndex) => ({
  id: `project-${projectIndex}`,
  label: `Project ${projectIndex}`,
  tasks: Array.from({ length: 8 }, (_, taskIndex) => ({
    id: `task-${projectIndex}-${taskIndex}`,
    label: `Task ${projectIndex}.${taskIndex}`,
    done: taskIndex % 2 === 0,
  })),
}));

let nestedKeyedOwnerExecutions = 0;

export function NestedKeyedRowExperiment() {
  const [projects, setProjects] = useState(initialProjects);
  const [updates, setUpdates] = useState(0);

  function reorderBothLevels() {
    setProjects((current) => {
      const rotated = [...current.slice(1), current[0]];
      return rotated.map((project) => {
        if (project.id !== "project-12") return project;
        const lastTask = project.tasks[project.tasks.length - 1];
        return {
          ...project,
          label: "Project 12 · updated",
          tasks: [
            { ...lastTask, label: `${lastTask.label} · moved`, done: true },
            ...project.tasks.slice(0, -1),
          ],
        };
      });
    });
    setUpdates((value) => value + 1);
  }

  function replaceOneInnerRow() {
    setProjects((current) =>
      current.map((project) =>
        project.id === "project-12"
          ? {
              ...project,
              tasks: [
                ...project.tasks.filter((task) => task.id !== "task-12-1"),
                {
                  id: `inserted-task-${updates}`,
                  label: `Inserted after update ${updates}`,
                  done: false,
                },
              ],
            }
          : project,
      ),
    );
    setUpdates((value) => value + 1);
  }

  return (
    <section className="heavy-benchmark" data-experiment="nested-keyed-rows">
      <header className="heavy-heading">
        <div>
          <span className="experiment-number">11</span>
          <div>
            <p className="heavy-kicker">NESTED KEYED ROWS</p>
            <h2>Each outer key owns an independent inner LIS scope</h2>
          </div>
        </div>
        <span className="node-badge">256 PROJECTS / 2,048 TASKS</span>
      </header>

      <p className="heavy-copy">
        The compiler scopes every task list to its stable project key. One update can move a project
        and reorder its tasks while preserving both levels of DOM identity, without rerunning this
        component.
      </p>

      <dl className="heavy-metrics" aria-live="polite">
        <div>
          <dt>Owner executions</dt>
          <dd data-metric="nested-keyed-owner-executions">
            {typeof window === "undefined" ? 1 : ++nestedKeyedOwnerExecutions}
          </dd>
        </div>
        <div>
          <dt>Projects</dt>
          <dd data-metric="nested-keyed-projects">{projects.length}</dd>
        </div>
        <div>
          <dt>Tasks</dt>
          <dd data-metric="nested-keyed-tasks">{projects.length * 8}</dd>
        </div>
        <div>
          <dt>Updates</dt>
          <dd data-metric="nested-keyed-updates">{updates}</dd>
        </div>
      </dl>

      <div className="heavy-controls composable-controls">
        <button data-action="nested-keyed-reorder" type="button" onClick={reorderBothLevels}>
          Reorder both levels <span aria-hidden="true">↗</span>
        </button>
        <button data-action="nested-keyed-replace" type="button" onClick={replaceOneInnerRow}>
          Replace one task
        </button>
      </div>

      <ol className="keyed-host-row-list" data-nested-project-list>
        {projects.map((project, projectIndex) => (
          <li
            data-nested-project={project.id}
            data-project-index={projectIndex}
            key={project.id}
          >
            <h3>{project.label}</h3>
            <ul data-nested-task-list={project.id}>
              <li data-nested-static="before">TASKS</li>
              {project.tasks.map((task, taskIndex) => (
                <li
                  data-nested-task={task.id}
                  data-task-index={taskIndex}
                  key={task.id}
                  style={{ opacity: task.done ? 1 : 0.72 }}
                  title={task.label}
                >
                  {task.label}
                </li>
              ))}
              <li data-nested-static="after">END</li>
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
