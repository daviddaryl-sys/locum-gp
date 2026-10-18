import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactNode,
} from "react";

type GuidedStepShellProps = {
  actionFormId?: string;
  actionLabel: string;
  actions: ReactNode;
  children: ReactNode;
  intro: string;
  title: string;
  titleAs?: "h1" | "h2";
};

function isFormAssociatedControl(element: string) {
  return (
    element === "button" ||
    element === "fieldset" ||
    element === "input" ||
    element === "object" ||
    element === "output" ||
    element === "select" ||
    element === "textarea"
  );
}

function associateActionControlsWithForm(
  actions: ReactNode,
  actionFormId: string,
): ReactNode {
  return Children.map(actions, (action) => {
    if (!isValidElement(action)) return action;

    const props = action.props as { children?: ReactNode; form?: string };
    const nextChildren =
      props.children === undefined
        ? props.children
        : associateActionControlsWithForm(props.children, actionFormId);
    const nextProps: { children?: ReactNode; form?: string } = {};

    if (nextChildren !== props.children) {
      nextProps.children = nextChildren;
    }

    if (
      typeof action.type === "string" &&
      isFormAssociatedControl(action.type) &&
      props.form === undefined
    ) {
      nextProps.form = actionFormId;
    }

    return Object.keys(nextProps).length > 0 ? cloneElement(action, nextProps) : action;
  });
}

export function GuidedStepShell({
  actionFormId,
  actionLabel,
  actions,
  children,
  intro,
  title,
  titleAs = "h2",
}: GuidedStepShellProps) {
  const titleId = useId();
  const TitleTag = titleAs;
  const resolvedActions =
    actionFormId === undefined
      ? actions
      : associateActionControlsWithForm(actions, actionFormId);

  return (
    <section
      aria-labelledby={titleId}
      className="guided-step-shell"
    >
      <header className="guided-step-shell__header">
        <TitleTag id={titleId}>{title}</TitleTag>
        <p className="guided-step-shell__intro">{intro}</p>
      </header>

      <div className="guided-step-shell__body">{children}</div>

      <div
        aria-label={actionLabel}
        className="guided-step-shell__actions"
        role="group"
      >
        {resolvedActions}
      </div>
    </section>
  );
}
