import React, { Profiler, StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompiledComponent,
  type CompiledComponentDefinition,
  type CompilerHostElement,
  type CompilerKeyedRowBinding,
  type CompilerStateUpdater,
} from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Task {
  id: string;
  title: string;
  done: boolean;
}

interface Project {
  id: string;
  name: string;
  tasks: Task[];
}

const initialProjects: Project[] = [
  {
    id: "a",
    name: "Alpha",
    tasks: [
      { id: "a1", title: "Design", done: false },
      { id: "a2", title: "Build", done: true },
      { id: "a3", title: "Ship", done: false },
    ],
  },
  {
    id: "b",
    name: "Beta",
    tasks: [
      { id: "b1", title: "Plan", done: false },
      { id: "b2", title: "Test", done: true },
      { id: "b3", title: "Release", done: false },
    ],
  },
  {
    id: "c",
    name: "Gamma",
    tasks: [
      { id: "c1", title: "Review", done: false },
      { id: "c2", title: "Merge", done: true },
    ],
  },
];

const roots: Array<{ unmount(): void }> = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function flushCompilerUpdates(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function host(
  tag: string,
  children: readonly unknown[] = [],
  attributes: readonly { name: string; value: unknown }[] = [],
  styles: readonly { name: string; value: unknown }[] = [],
): CompilerHostElement {
  return { kind: "element", tag, attributes, styles, children };
}

function taskDescriptor(task: Task, index: number, prefix: string): CompilerHostElement {
  return host(
    "li",
    [host("span", [prefix, task.title]), host("small", [task.done ? "done" : "open"])],
    [
      { name: "data-task", value: task.id },
      { name: "data-task-index", value: index },
      { name: "title", value: task.title },
    ],
    [{ name: "opacity", value: task.done ? 1 : 0.7 }],
  );
}

function taskBindings(prefix: string): CompilerKeyedRowBinding[] {
  return [
    {
      kind: "attribute",
      path: [],
      name: "data-task-index",
      read: (_task, index) => index,
    },
    {
      kind: "attribute",
      path: [],
      name: "title",
      read: (task) => (task as Task).title,
    },
    {
      kind: "style",
      path: [],
      name: "opacity",
      read: (task) => ((task as Task).done ? 1 : 0.7),
    },
    {
      kind: "text",
      path: [0],
      read: (task) => [prefix, (task as Task).title],
    },
    {
      kind: "text",
      path: [1],
      read: (task) => ((task as Task).done ? "done" : "open"),
    },
  ];
}

function projectDescriptor(project: Project, index: number, prefix: string): CompilerHostElement {
  const taskRange = {
    before: 1,
    items: () => project.tasks,
    rowKey: (task: unknown) => (task as Task).id,
    create: (task: unknown, taskIndex: number) => taskDescriptor(task as Task, taskIndex, prefix),
    bindings: taskBindings(prefix),
  };
  return host(
    "section",
    [
      host("h3", [prefix, project.name]),
      {
        ...host("ul", [
          host("i", ["TASKS"]),
          ...project.tasks.map((task, taskIndex) => taskDescriptor(task, taskIndex, prefix)),
          host("b", ["END"]),
        ]),
        block: {
          kind: "keyed-ranges",
          id: 1,
          ranges: [taskRange],
          trailing: 1,
        },
      },
    ],
    [
      { name: "data-project", value: project.id },
      { name: "data-project-index", value: index },
    ],
  );
}

function projectBindings(prefix: string): CompilerKeyedRowBinding[] {
  return [
    {
      kind: "attribute",
      path: [],
      name: "data-project-index",
      read: (_project, index) => index,
    },
    {
      kind: "text",
      path: [0],
      read: (project) => [prefix, (project as Project).name],
    },
  ];
}

function projectMarkup(project: Project, index: number, prefix: string): React.ReactElement {
  return (
    <section data-project={project.id} data-project-index={index} key={project.id}>
      <h3>
        {prefix}
        {project.name}
      </h3>
      <ul>
        <i>TASKS</i>
        {project.tasks.map((task, taskIndex) => (
          <li
            data-task={task.id}
            data-task-index={taskIndex}
            key={task.id}
            style={{ opacity: task.done ? 1 : 0.7 }}
            title={task.title}
          >
            <span>
              {prefix}
              {task.title}
            </span>
            <small>{task.done ? "done" : "open"}</small>
          </li>
        ))}
        <b>END</b>
      </ul>
    </section>
  );
}

function createNestedRowsFixture() {
  let executions = 0;
  let setProjects: (next: CompilerStateUpdater) => void = () => undefined;
  const Rows = createCompiledComponent({
    displayName: "NestedKeyedRows",
    initialize: () => [initialProjects],
    render(props: { prefix: string }, state, blocks) {
      executions += 1;
      setProjects = state[0].set;
      const projects = () => state[0].get() as Project[];
      const KeyedRows = blocks.KeyedRows;
      return (
        <main>
          <KeyedRows
            bindings={projectBindings(props.prefix)}
            create={(project, index) => projectDescriptor(project as Project, index, props.prefix)}
            hostBlocks
            id={0}
            items={projects}
            render={() => (
              <div data-projects>
                {projects().map((project, index) => projectMarkup(project, index, props.prefix))}
              </div>
            )}
            rowKey={(project) => (project as Project).id}
          />
        </main>
      );
    },
    bindings: [
      { kind: "block", id: 0, dependencies: [0] },
      { kind: "block", id: 1, parent: 0, dependencies: [] },
    ],
  });
  return {
    Rows,
    executions: () => executions,
    setProjects: (next: CompilerStateUpdater) => setProjects(next),
  };
}

function semanticProjects(container: Element, owner: string) {
  return [...container.querySelectorAll<HTMLElement>(`${owner} [data-project]`)].map((project) => ({
    id: project.dataset.project,
    index: project.dataset.projectIndex,
    name: project.querySelector("h3")?.textContent,
    tasks: [...project.querySelectorAll<HTMLElement>("[data-task]")].map((task) => ({
      id: task.dataset.task,
      index: task.dataset.taskIndex,
      title: task.getAttribute("title"),
      label: task.querySelector("span")?.textContent,
      status: task.querySelector("small")?.textContent,
      opacity: task.style.opacity,
    })),
  }));
}

describe("compiler-owned nested keyed rows runtime", () => {
  it("runs independent outer and inner LIS passes without React commits or lost identity", async () => {
    let profilerCommits = 0;
    const fixture = createNestedRowsFixture();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <StrictMode>
          <Profiler id="nested-rows" onRender={() => (profilerCommits += 1)}>
            <fixture.Rows prefix="Live: " />
          </Profiler>
        </StrictMode>,
      ),
    );

    const executionsAfterMount = fixture.executions();
    const commitsAfterMount = profilerCommits;
    const projectB = container.querySelector<HTMLElement>('[data-project="b"]')!;
    const taskB1 = projectB.querySelector<HTMLElement>('[data-task="b1"]')!;
    const taskB2 = projectB.querySelector<HTMLElement>('[data-task="b2"]')!;
    const taskB3 = projectB.querySelector<HTMLElement>('[data-task="b3"]')!;
    const staticBefore = projectB.querySelector("ul > i");
    const staticAfter = projectB.querySelector("ul > b");
    let outerMoves = 0;
    let innerMoves = 0;
    const projectsRoot = container.querySelector<HTMLElement>("[data-projects]")!;
    const tasksRoot = projectB.querySelector<HTMLElement>("ul")!;
    const outerInsertBefore = projectsRoot.insertBefore.bind(projectsRoot);
    projectsRoot.insertBefore = (node, anchor) => {
      if (node.parentNode === projectsRoot) outerMoves += 1;
      return outerInsertBefore(node, anchor);
    };
    const innerInsertBefore = tasksRoot.insertBefore.bind(tasksRoot);
    tasksRoot.insertBefore = (node, anchor) => {
      if (node.parentNode === tasksRoot && (node as Element).matches?.("[data-task]")) {
        innerMoves += 1;
      }
      return innerInsertBefore(node, anchor);
    };

    await act(async () => {
      fixture.setProjects((current) => {
        const [a, b, c] = current as Project[];
        return [
          c,
          a,
          {
            ...b,
            name: "Beta updated",
            tasks: [
              { ...b.tasks[2], title: "Release now", done: true },
              b.tasks[0],
              { ...b.tasks[1], done: false },
              { id: "b4", title: "Observe", done: false },
            ],
          },
        ];
      });
      await flushCompilerUpdates();
    });

    expect(
      [...container.querySelectorAll<HTMLElement>("[data-project]")].map(
        (project) => project.dataset.project,
      ),
    ).toEqual(["c", "a", "b"]);
    expect(container.querySelector('[data-project="b"]')).toBe(projectB);
    expect(projectB.querySelector('[data-task="b1"]')).toBe(taskB1);
    expect(projectB.querySelector('[data-task="b2"]')).toBe(taskB2);
    expect(projectB.querySelector('[data-task="b3"]')).toBe(taskB3);
    expect(projectB.querySelector("ul > i")).toBe(staticBefore);
    expect(projectB.querySelector("ul > b")).toBe(staticAfter);
    expect(
      [...projectB.querySelectorAll<HTMLElement>("[data-task]")].map((task) => task.dataset.task),
    ).toEqual(["b3", "b1", "b2", "b4"]);
    expect(projectB.querySelector('[data-task="b3"] span')?.textContent).toBe("Live: Release now");
    expect(projectB.querySelector('[data-task="b2"] small')?.textContent).toBe("open");
    expect(outerMoves).toBe(1);
    expect(innerMoves).toBe(1);
    expect(fixture.executions()).toBe(executionsAfterMount);
    expect(profilerCommits).toBe(commitsAfterMount);
  });

  it("combines parent props with inner updates and drops a queued update after unmount", async () => {
    const fixture = createNestedRowsFixture();
    function Parent() {
      const [prefix, setPrefix] = useState("Before: ");
      return (
        <>
          <button data-parent onClick={() => setPrefix("After: ")} type="button" />
          <fixture.Rows prefix={prefix} />
        </>
      );
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Parent />));
    const task = container.querySelector('[data-task="a2"]');

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-parent]")?.click();
      fixture.setProjects((current) =>
        (current as Project[]).map((project) =>
          project.id === "a"
            ? {
                ...project,
                tasks: project.tasks.map((currentTask) =>
                  currentTask.id === "a2"
                    ? { ...currentTask, title: "Built together", done: false }
                    : currentTask,
                ),
              }
            : project,
        ),
      );
      await flushCompilerUpdates();
    });
    expect(container.querySelector('[data-task="a2"]')).toBe(task);
    expect(container.querySelector('[data-task="a2"] span')?.textContent).toBe(
      "After: Built together",
    );

    fixture.setProjects((current) => [...(current as Project[])].reverse());
    await act(async () => root.unmount());
    roots.splice(roots.indexOf(root), 1);
    await flushCompilerUpdates();
    expect(container.innerHTML).toBe("");
  });

  it("adopts hydrated nested rows and recovers from server mismatches", async () => {
    for (const mismatch of [false, true]) {
      const fixture = createNestedRowsFixture();
      const container = document.createElement("div");
      const serverHtml = renderToString(<fixture.Rows prefix="SSR: " />);
      container.innerHTML = mismatch
        ? serverHtml.replace("Design</span>", "Server mismatch</span>")
        : serverHtml;
      document.body.append(container);
      const recoverable = vi.fn();
      let root!: ReturnType<typeof hydrateRoot>;
      await act(async () => {
        root = hydrateRoot(container, <fixture.Rows prefix="SSR: " />, {
          onRecoverableError: recoverable,
        });
        await flushCompilerUpdates();
      });
      roots.push(root);
      const task = container.querySelector('[data-task="a1"]');
      if (mismatch) expect(recoverable).toHaveBeenCalled();
      else expect(recoverable).not.toHaveBeenCalled();

      await act(async () => {
        fixture.setProjects((current) =>
          (current as Project[]).map((project) =>
            project.id === "a"
              ? {
                  ...project,
                  tasks: [
                    project.tasks[2],
                    { ...project.tasks[0], title: "Hydrated", done: true },
                    project.tasks[1],
                  ],
                }
              : project,
          ),
        );
        await flushCompilerUpdates();
      });
      expect(container.querySelector('[data-task="a1"]')).toBe(task);
      expect(container.querySelector('[data-task="a1"] span')?.textContent).toBe("SSR: Hydrated");

      await act(async () => root.unmount());
      roots.splice(roots.indexOf(root), 1);
      container.remove();
    }
  });

  it("falls back to React for duplicate inner keys and remains live", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fixture = createNestedRowsFixture();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<fixture.Rows prefix="Safe: " />));

    await act(async () => {
      fixture.setProjects((current) =>
        (current as Project[]).map((project) =>
          project.id === "a"
            ? {
                ...project,
                tasks: [
                  { ...project.tasks[0], title: "First" },
                  { ...project.tasks[0], title: "Duplicate" },
                ],
              }
            : project,
        ),
      );
      await flushCompilerUpdates();
    });
    expect(container.querySelectorAll('[data-project="a"] [data-task="a1"]')).toHaveLength(2);
    expect(container.textContent).toContain("Duplicate");

    await act(async () => {
      fixture.setProjects((current) =>
        (current as Project[]).map((project) =>
          project.id === "a"
            ? { ...project, tasks: [{ id: "safe", title: "Safe again", done: true }] }
            : project,
        ),
      );
      await flushCompilerUpdates();
    });
    expect(container.querySelector('[data-task="safe"] span')?.textContent).toBe(
      "Safe: Safe again",
    );
  });

  it("matches normal React across 2,500 deterministic two-level mutations", async () => {
    type Action =
      | "outer-reverse"
      | "outer-rotate"
      | "inner-reverse"
      | "inner-rotate"
      | "inner-edit"
      | "inner-toggle"
      | "inner-add"
      | "inner-remove";
    let normalSet: React.Dispatch<React.SetStateAction<Project[]>> = () => undefined;
    const fixture = createNestedRowsFixture();

    function Normal() {
      const [projects, setProjects] = useState(initialProjects);
      normalSet = setProjects;
      return (
        <div data-normal>
          {projects.map((project, index) => projectMarkup(project, index, "Test: "))}
        </div>
      );
    }

    const transition = (projects: Project[], action: Action, step: number): Project[] => {
      if (action === "outer-reverse") return [...projects].reverse();
      if (action === "outer-rotate" && projects.length > 1) {
        return [...projects.slice(1), projects[0]];
      }
      if (projects.length === 0) return projects;
      const projectIndex = step % projects.length;
      return projects.map((project, index) => {
        if (index !== projectIndex) return project;
        const tasks = project.tasks;
        if (action === "inner-reverse") return { ...project, tasks: [...tasks].reverse() };
        if (action === "inner-rotate" && tasks.length > 1) {
          return { ...project, tasks: [...tasks.slice(1), tasks[0]] };
        }
        if (action === "inner-edit" && tasks.length > 0) {
          return {
            ...project,
            tasks: tasks.map((task, taskIndex) =>
              taskIndex === step % tasks.length ? { ...task, title: `${task.title}!` } : task,
            ),
          };
        }
        if (action === "inner-toggle" && tasks.length > 0) {
          return {
            ...project,
            tasks: tasks.map((task, taskIndex) =>
              taskIndex === step % tasks.length ? { ...task, done: !task.done } : task,
            ),
          };
        }
        if (action === "inner-add" && tasks.length < 8) {
          let candidate = step;
          const ids = new Set(tasks.map((task) => task.id));
          while (ids.has(`${project.id}-n${candidate}`)) candidate += 1;
          return {
            ...project,
            tasks: [
              ...tasks,
              {
                id: `${project.id}-n${candidate}`,
                title: `New ${candidate}`,
                done: candidate % 2 === 0,
              },
            ],
          };
        }
        if (action === "inner-remove" && tasks.length > 1) {
          return { ...project, tasks: tasks.slice(1) };
        }
        return project;
      });
    };

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <>
          <div data-compiled>
            <fixture.Rows prefix="Test: " />
          </div>
          <Normal />
        </>,
      ),
    );
    const executionsAfterMount = fixture.executions();
    const actions: Action[] = [
      "outer-reverse",
      "outer-rotate",
      "inner-reverse",
      "inner-rotate",
      "inner-edit",
      "inner-toggle",
      "inner-add",
      "inner-remove",
    ];
    let random = 0x81a5b7c3;
    for (let step = 0; step < 2500; step += 1) {
      random = (random * 1664525 + 1013904223) >>> 0;
      const action = actions[random % actions.length];
      await act(async () => {
        fixture.setProjects((current) => transition(current as Project[], action, step));
        normalSet((current) => transition(current, action, step));
        await flushCompilerUpdates();
      });
      expect(semanticProjects(container, "[data-compiled]")).toEqual(
        semanticProjects(container, "[data-normal]"),
      );
    }
    expect(fixture.executions()).toBe(executionsAfterMount);
  }, 20_000);

  it("preserves nested identities and state through compatible Fast Refresh", async () => {
    const hmrId = `nested-keyed-rows-refresh-${Math.random()}`;
    const definition = (prefix: string): CompiledComponentDefinition<Record<string, never>> => ({
      displayName: "RefreshNestedKeyedRows",
      hmrId,
      stateSignature: "projects",
      initialize: () => [initialProjects],
      render(_props, state, blocks) {
        const projects = () => state[0].get() as Project[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <main>
            <KeyedRows
              bindings={projectBindings(prefix)}
              create={(project, index) => projectDescriptor(project as Project, index, prefix)}
              hostBlocks
              id={0}
              items={projects}
              render={() => (
                <div>
                  {projects().map((project, index) => projectMarkup(project, index, prefix))}
                </div>
              )}
              rowKey={(project) => (project as Project).id}
            />
          </main>
        );
      },
      bindings: [
        { kind: "block", id: 0, dependencies: [0] },
        { kind: "block", id: 1, parent: 0, dependencies: [] },
      ],
    });

    const Initial = createCompiledComponent(definition("Before: "));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Initial />));
    const project = container.querySelector('[data-project="a"]');
    const task = container.querySelector('[data-task="a1"]');

    let Refreshed = Initial;
    await act(async () => {
      Refreshed = createCompiledComponent(definition("After: "));
      root.render(<Refreshed />);
      await flushCompilerUpdates();
    });
    expect(Refreshed).toBe(Initial);
    expect(container.querySelector('[data-project="a"]')).toBe(project);
    expect(container.querySelector('[data-task="a1"]')).toBe(task);
    expect(container.querySelector('[data-task="a1"] span')?.textContent).toBe("After: Design");
  });
});
