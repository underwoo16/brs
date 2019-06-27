sub Main()
    ' Tests createNodeByType is properly parsing xml files, creating fields, and setting field values
    view = createObject("roSGNode", "LiveGuideGrid")
    print "view.panelShown: "
    print view.panelShown
    print "view.moveDirection: "
    print view.moveDirection
    print "view.rowFocused: "
    print view.rowFocused
end sub