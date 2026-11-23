!ifndef BUILD_UNINSTALLER
  !define MUI_WELCOMEFINISHPAGE_BITMAP_STRETCH AspectFitHeight
  !define MUI_UNWELCOMEFINISHPAGE_BITMAP_STRETCH AspectFitHeight
  !define MUI_HEADERIMAGE_BITMAP_STRETCH NoStretchNoCropNoAlign
  !define MUI_ABORTWARNING

  !define MUI_FINISHPAGE_TITLE "pMusic está listo"
  !define MUI_FINISHPAGE_TEXT "pMusic se ha instalado correctamente en tu equipo.$\r$\n$\r$\nPuedes abrirlo desde el escritorio o el menú Inicio."
  !define MUI_FINISHPAGE_RUN_TEXT "Iniciar pMusic ahora"
!endif

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Bienvenido a pMusic"
  !define MUI_WELCOMEPAGE_TEXT "Este asistente instalará pMusic v0.12.0 en tu equipo.$\r$\n$\r$\nDisfruta de reproducción de audio rápida, letras sincronizadas a 60 FPS, modo Liquid Glass y motor Pro-DJ AutoMix.$\r$\n$\r$\nHaz clic en Siguiente para continuar."
  !insertmacro MUI_PAGE_WELCOME
!macroend
