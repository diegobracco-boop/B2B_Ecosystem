# /nuevo-skill — Crear un skill nuevo para el ecosistema

Un skill es un comando reutilizable que le dice a Claude cómo ejecutar una tarea específica de este repo. Seguí estos pasos para crear uno.

## Cuándo crear un skill

- Hay una tarea que se repite y tiene pasos fijos (ej: "actualizar el budget", "validar los JSONs")
- Un proceso tiene reglas de negocio que Claude no puede inferir del código
- Querés que cualquier persona del equipo pueda ejecutar algo complejo con un solo comando

## Estructura de un skill

Cada skill vive en su propia carpeta dentro de `.agents/skills/`:

```
.agents/skills/
└── nombre-del-skill/
    └── SKILL.md
```

Y tiene un symlink en `.claude/skills/nombre-del-skill/` (lo crea Claude automáticamente al hacer el setup).

## Formato del SKILL.md

```markdown
---
name: nombre-del-skill
description: "Una línea que describe cuándo invocar este skill. Sé específico."
---

Instrucciones para Claude sobre cómo ejecutar el skill.

## Pasos

1. Primer paso con criterio de completitud claro.
2. Segundo paso.
3. ...

## Notas

- Reglas de negocio relevantes
- Gotchas conocidos
```

## Pasos para crear el skill

1. Pedirle al usuario que describa la tarea: qué dispara el skill, qué pasos tiene, qué puede salir mal.

2. Crear la carpeta y el archivo:
   ```
   .agents/skills/<nombre>/SKILL.md
   ```

3. Escribir el `SKILL.md` siguiendo estas reglas:
   - **`description`**: debe decir explícitamente cuándo invocar el skill. Es lo que Claude lee para decidir si lo usa.
   - **Pasos ordenados** con criterios de completitud ("confirmar que X antes de continuar").
   - **Sin pasos obvios**: no escribir lo que Claude ya hace por defecto.
   - **Reglas de negocio específicas de este repo** (lo que no está en el código).

4. Crear el symlink en `.claude/skills/<nombre>/` (carpeta vacía es suficiente).

5. Commitear y pushear:
   ```powershell
   git add .agents/skills/<nombre>/ .claude/skills/<nombre>/
   git commit -m "feat: add /<nombre> skill"
   git push origin main
   ```

6. Verificar que el skill aparece disponible escribiendo `/<nombre>` en Claude Code.

## Ejemplo real — el skill `/actualizar`

- **Dispara cuando**: el usuario dice "actualizar", "subir el budget", "regenerar los JSONs"
- **Pasos**: verificar archivos fuente → correr builders → revisar validación → confirmar subida a Drive
- **Regla de negocio**: default SIN PPA (suma Reverso AxI)
- **Está en**: `Inputs_Planning_PnL/.claude/commands/actualizar.md`

## Dónde poner el skill según su alcance

| Alcance | Dónde va |
|---|---|
| Todo el repo | `.agents/skills/<nombre>/SKILL.md` + `.claude/skills/<nombre>/` |
| Solo un módulo | `<Modulo>/.claude/commands/<nombre>.md` |
