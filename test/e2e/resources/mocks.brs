sub Main()
    ' testing mock objects with functions
    _brs_.mockComponent("roTimespan", {
        mark: (sub()
            print "marking mock timespan"
        end sub),
        totalMilliseconds: (function()
            return 8
        end function),
        name: "timespan"
    })
    mockTimespan = createObject("roTimespan")
    mockTimespan.mark()
    print "mocked timespan should return 8: " mockTimespan.totalMilliseconds()  ' => 8

    ' testing the type of mocked objects
    realRegex = createObject("roRegex", "[a-z]+", "i")
    print "create object regex:" type(realRegex)                                ' => roRegex

    _brs_.mockComponent("roRegex", {})
    mockRegex = createObject("roRegex", "a-z+", "i")
    print "mock object regex:" type(mockRegex)                                  ' => roSGNode

    ' testing observe field of mock object
    ' TODO: once observe field is merged, add this test case to BrsMock.test.js
    mockTimespan.observeField("name", "onNameChanged")
    mockTimespan.name = "updated name"

    ' testing mock objects with fields, functions and parameters
    _brs_.mockComponent("roSGNode", {
        getChild: (function(index as integer)
            return { index: index }
        end function)
    })
    mockNode = createObject("roSGNode", "Node")
    mockNode.id = "node-id"
    mockNode.name = "node-name"
    mockChild = mockNode.getChild(333)

    print "mocked node id:" mockNode.id                     ' => node-id
    print "mocked node name:" mockNode.name                 ' => node-name
    print "mocked node child index:" mockChild.index        ' => 333
end sub

sub onNameChanged()
    print "in name change callback"
end sub
