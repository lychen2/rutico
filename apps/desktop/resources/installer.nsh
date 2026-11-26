!include "StrFunc.nsh"
!ifdef BUILD_UNINSTALLER
  ${UnStrRep}
  !define T3StrRep '${UnStrRep}'
!else
  ${StrRep}
  !define T3StrRep '${StrRep}'
!endif

!macro customAppRunningMessages
  Push $0
  Push $1
  ${If} $IsPowerShellAvailable == 0
    System::Call 'kernel32::SetEnvironmentVariable(t "T3CODE_INSTALL_DIR", t "$INSTDIR")'
    nsExec::ExecToStack `"$PowerShellPath" -NoProfile -NonInteractive -C "Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ExecutablePath -and [IO.Path]::GetDirectoryName($$_.ExecutablePath) -eq $$env:T3CODE_INSTALL_DIR } | ForEach-Object { [IO.Path]::GetFileNameWithoutExtension($$_.ExecutablePath) } | Where-Object { $$_ -in 'Rutico', 'Rutico (Beta)', 'Rutico (Nightly)', 'T3 Code (Alpha)', 'T3 Code (Beta)', 'T3 Code (Nightly)' } | Select-Object -First 1 | ForEach-Object { [Console]::Write($$_) }"`
    Pop $0
    Pop $1
    System::Call 'kernel32::SetEnvironmentVariable(t "T3CODE_INSTALL_DIR", p 0)'
    ${If} $0 == 0
      ${If} $1 == "Rutico"
      ${OrIf} $1 == "Rutico (Beta)"
      ${OrIf} $1 == "Rutico (Nightly)"
      ${OrIf} $1 == "T3 Code (Alpha)"
      ${OrIf} $1 == "T3 Code (Beta)"
      ${OrIf} $1 == "T3 Code (Nightly)"
        ${T3StrRep} $appRunningMessage $appRunningMessage "${PRODUCT_NAME}" $1
        ${T3StrRep} $appClosingMessage $appClosingMessage "${PRODUCT_NAME}" $1
        ${T3StrRep} $appCannotBeClosedMessage $appCannotBeClosedMessage "${PRODUCT_NAME}" $1
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $1
  Pop $0
!macroend

!macro customInstall
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    ${IfNot} ${FileExists} "$newStartMenuLink"
      !insertmacro createMenuDirectory
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ${EndIf}
  !endif
  ; Register external Rutico pairing protocol in HKCU without touching official t3code:// or dev schemes.
  WriteRegStr HKCU "Software\Classes\rutico" "" "URL:Rutico Protocol"
  WriteRegStr HKCU "Software\Classes\rutico" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\rutico\DefaultIcon" "" '"$appExe",0'
  WriteRegStr HKCU "Software\Classes\rutico\shell\open\command" "" '"$appExe" "%1"'
  ${If} "${PRODUCT_NAME}" == "Rutico (Nightly)"
    WriteRegStr HKCU "Software\Classes\rutico-preview" "" "URL:Rutico Preview Protocol"
    WriteRegStr HKCU "Software\Classes\rutico-preview" "URL Protocol" ""
    WriteRegStr HKCU "Software\Classes\rutico-preview\DefaultIcon" "" '"$appExe",0'
    WriteRegStr HKCU "Software\Classes\rutico-preview\shell\open\command" "" '"$appExe" "%1"'
  ${EndIf}
!macroend

!macro customUnInstall
  ReadRegStr $0 HKCU "Software\Classes\rutico\shell\open\command" ""
  ${If} $0 == '"$appExe" "%1"'
    DeleteRegKey HKCU "Software\Classes\rutico"
  ${EndIf}
  ReadRegStr $0 HKCU "Software\Classes\rutico-preview\shell\open\command" ""
  ${If} $0 == '"$appExe" "%1"'
    DeleteRegKey HKCU "Software\Classes\rutico-preview"
  ${EndIf}
!macroend
